import { Server, Socket } from 'socket.io';
import { Player, Snake, SnakeSegment, Pellet, GameState, PlayerStats, GameEndResult, LeaderboardEntry, Vector2, Apple } from './types.js';
import { Physics } from './physics.js';
import { SpatialHash } from './spatialHash.js';
import { config } from './config.js';

export class GameRoom {
  id: string;
  sessionId?: string; // Unique session ID for database auditing
  tier: string;
  io: Server;
  players: Map<string, Player>;
  pellets: Map<string, Pellet>;
  spatialHash: SpatialHash;
  gameState: GameState;
  tickInterval: NodeJS.Timeout | null;
  gameStartTime: number;
  maxDuration: number;
  currentMapBounds: { minX: number; maxX: number; minY: number; maxY: number };
  onGameEnd?: () => void;
  onWinnerDetermined?: (winnerId: string, winnerName: string, gameId: string, sessionId: string, tier: string, playersCount: number) => Promise<void>;
  onCheatDetected?: (playerId: string, playerName: string, reason: string) => void;
  lastWinnerId?: string;
  lastWinnerName?: string;
  lastWinnerWallet?: string;
  private lastWinCheckTime: number = 0;
  private lastAppleHolderId?: string; // Track last player who held apple (for winner-kills-holder case)
  onAppleReward?: (playerId: string, walletAddress: string, reason: 'held_at_end' | 'killed_holder') => Promise<void>;
  
  constructor(id: string, tier: string, io: Server) {
    this.id = id;
    this.tier = tier;
    this.io = io;
    this.players = new Map();
    this.pellets = new Map();
    this.spatialHash = new SpatialHash(config.game.spatialHashGridSize);
    this.tickInterval = null;
    this.gameStartTime = Date.now();
    this.maxDuration = config.game.maxGameDuration;
    this.currentMapBounds = { 
      minX: 0, 
      maxX: config.game.mapWidth, 
      minY: 0, 
      maxY: config.game.mapHeight 
    };
    
    this.gameState = {
      players: this.players,
      pellets: this.pellets,
      spectators: new Set(),
      startTime: this.gameStartTime,
      lastTickTime: Date.now(),
      apple: null, // Initialize without apple
    };

    this.initializePellets();
  }

  /**
   * Initialize pellets across the map
   */
  private initializePellets(): void {
    // CHRISTMAS THEME: All pellets are white (snow on ground)
    for (let i = 0; i < config.game.pelletCount; i++) {
      const pellet: Pellet = {
        id: `pellet_${i}`,
        x: Math.random() * config.game.mapWidth,
        y: Math.random() * config.game.mapHeight,
        mass: 1,
        color: '#FFFFFF', // White for snow effect
      };
      this.pellets.set(pellet.id, pellet);
    }
  }

  /**
   * Initialize apple based on spawn rate rules
   */
  private initializeApple(): void {
    let shouldSpawn = false;

    // Determine spawn rate based on tier
    if (this.tier === 'dream') {
      // 10% spawn rate for Dream mode
      const roll = Math.random() * 100;
      shouldSpawn = roll < 10;
      console.log(`🍎 Apple spawn roll for Dream mode: ${roll.toFixed(2)} ${shouldSpawn ? '✓ WILL SPAWN' : '✗ NO SPAWN'}`);
    } else {
      // 100% spawn rate for paid entry games
      shouldSpawn = true;
      console.log(`🍎 Apple will spawn in paid tier: ${this.tier}`);
    }

    if (shouldSpawn) {
      console.log(`🍎 Calling spawnApple() now...`);
      this.spawnApple();
      console.log(`🍎 After spawnApple(), apple state:`, this.gameState.apple ? 'EXISTS' : 'NULL');
    } else {
      this.gameState.apple = null;
      console.log(`🍎 No apple this game`);
    }
  }

  /**
   * Spawn apple at a valid position
   */
  private spawnApple(): void {
    const PLAYER_BUFFER = 200;
    const MAX_ATTEMPTS = 10;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const x = this.currentMapBounds.minX + Math.random() * (this.currentMapBounds.maxX - this.currentMapBounds.minX);
      const y = this.currentMapBounds.minY + Math.random() * (this.currentMapBounds.maxY - this.currentMapBounds.minY);
      
      // Check if position is too close to any player spawn (only if players exist)
      let tooClose = false;
      if (this.players.size > 0) {
        for (const player of this.players.values()) {
          if (player.snake.segments.length > 0) {
            const head = player.snake.segments[0];
            const dist = Math.hypot(x - head.x, y - head.y);
            if (dist < PLAYER_BUFFER) {
              tooClose = true;
              break;
            }
          }
        }
      }
      
      if (!tooClose) {
        const apple: Apple = {
          id: `apple_${Date.now()}`,
          x,
          y,
          heldBy: null,
          spawnTime: Date.now(),
        };
        
        this.gameState.apple = apple;
        
        // Broadcast apple spawn to all clients
        this.io.to(this.id).emit('appleSpawned', {
          appleId: apple.id,
          x: apple.x,
          y: apple.y,
          spawnTime: apple.spawnTime,
        });
        
        console.log(`🍎 Apple spawned at (${Math.floor(x)}, ${Math.floor(y)})`);
        return;
      }
    }
    
    // Failed to find valid position after max attempts - still spawn it anyway
    console.log(`⚠️ Failed to find ideal spawn position after ${MAX_ATTEMPTS} attempts, spawning anyway`);
    
    // Spawn at center of map as fallback
    const centerX = (this.currentMapBounds.minX + this.currentMapBounds.maxX) / 2;
    const centerY = (this.currentMapBounds.minY + this.currentMapBounds.maxY) / 2;
    
    const apple: Apple = {
      id: `apple_${Date.now()}`,
      x: centerX,
      y: centerY,
      heldBy: null,
      spawnTime: Date.now(),
    };
    
    this.gameState.apple = apple;
    
    // Broadcast apple spawn to all clients
    this.io.to(this.id).emit('appleSpawned', {
      appleId: apple.id,
      x: apple.x,
      y: apple.y,
      spawnTime: apple.spawnTime,
    });
    
    console.log(`🍎 Apple spawned at center (${Math.floor(centerX)}, ${Math.floor(centerY)})`);
  }

  /**
   * Check apple pickup collisions
   */
  private checkAppleCollisions(): void {
    const apple = this.gameState.apple;
    if (!apple || apple.heldBy) return; // Skip if no apple or already held
    
    const APPLE_RADIUS = 12;
    
    for (const player of this.players.values()) {
      if (player.snake.segments.length === 0) continue;
      
      const head = player.snake.segments[0];
      const dist = Math.hypot(head.x - apple.x, head.y - apple.y);
      
      if (dist < Physics.HEAD_RADIUS + APPLE_RADIUS) {
        // Player picked up apple
        apple.heldBy = player.id;
        this.lastAppleHolderId = player.id;
        
        console.log(`🍎 ${player.name} picked up the apple!`);
        
        // Broadcast pickup to all clients
        this.io.to(this.id).emit('applePickedUp', {
          appleId: apple.id,
          playerId: player.id,
          playerName: player.name,
        });
        
        return; // Only one player can pick it up
      }
    }
  }

  /**
   * Drop apple at position (when player dies or disconnects)
   */
  private dropApple(x: number, y: number, droppedBy: string, reason: 'death' | 'disconnect'): void {
    const apple = this.gameState.apple;
    if (!apple || apple.heldBy !== droppedBy) return;
    
    apple.x = x;
    apple.y = y;
    apple.heldBy = null;
    
    console.log(`🍎 Apple dropped at (${Math.floor(x)}, ${Math.floor(y)}) - reason: ${reason}`);
    
    // Check if apple is outside safe zone
    if (x < this.currentMapBounds.minX || x > this.currentMapBounds.maxX ||
        y < this.currentMapBounds.minY || y > this.currentMapBounds.maxY) {
      console.log(`⚠️ Dropped apple outside safe zone, respawning...`);
      this.respawnApple();
      return;
    }
    
    // Broadcast drop to all clients
    this.io.to(this.id).emit('appleDropped', {
      appleId: apple.id,
      x: apple.x,
      y: apple.y,
      droppedBy,
      reason,
    });
  }

  /**
   * Respawn apple in safe zone (called when apple hits boundary)
   */
  private respawnApple(): void {
    if (!this.gameState.apple) return;
    
    const BOUNDARY_BUFFER = 50;
    const PLAYER_BUFFER = 100;
    const MAX_ATTEMPTS = 10;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const x = this.currentMapBounds.minX + BOUNDARY_BUFFER + 
                Math.random() * (this.currentMapBounds.maxX - this.currentMapBounds.minX - BOUNDARY_BUFFER * 2);
      const y = this.currentMapBounds.minY + BOUNDARY_BUFFER + 
                Math.random() * (this.currentMapBounds.maxY - this.currentMapBounds.minY - BOUNDARY_BUFFER * 2);
      
      // Check if too close to any player
      let tooClose = false;
      for (const player of this.players.values()) {
        if (player.snake.segments.length > 0) {
          const head = player.snake.segments[0];
          const dist = Math.hypot(x - head.x, y - head.y);
          if (dist < PLAYER_BUFFER) {
            tooClose = true;
            break;
          }
        }
      }
      
      if (!tooClose) {
        const apple = this.gameState.apple;
        apple.x = x;
        apple.y = y;
        apple.heldBy = null;
        
        console.log(`🍎 Apple respawned at (${Math.floor(x)}, ${Math.floor(y)})`);
        
        this.io.to(this.id).emit('appleRespawned', {
          appleId: apple.id,
          x: apple.x,
          y: apple.y,
          reason: 'zone_shrink',
        });
        
        return;
      }
    }
    
    // No valid position found - remove apple
    console.log(`⚠️ No valid position for apple respawn - removing apple from game`);
    this.gameState.apple = null;
    this.io.to(this.id).emit('appleRemoved', {
      appleId: this.gameState.apple?.id || 'unknown',
      reason: 'no_valid_position',
    });
  }

  /**
   * Check if apple is outside safe zone
   */
  private checkAppleZoneSafety(): void {
    const apple = this.gameState.apple;
    if (!apple || apple.heldBy) return; // Skip if no apple or being held
    
    const isOutside = apple.x < this.currentMapBounds.minX || apple.x > this.currentMapBounds.maxX ||
                      apple.y < this.currentMapBounds.minY || apple.y > this.currentMapBounds.maxY;
    
    if (isOutside) {
      console.log(`🍎 Apple hit by shrinking zone, respawning...`);
      this.respawnApple();
    }
  }

  /**
   * Add player to game
   */
  addPlayer(socketId: string, playerId: string, name: string, isBot: boolean = false, walletAddress?: string, equippedCosmetics?: any): void {
    const startX = Math.random() * config.game.mapWidth;
    const startY = Math.random() * config.game.mapHeight;
    const startAngle = Math.random() * Math.PI * 2;

    // Get stat multiplier for this tier
    const gameMode = config.gameModes.find(m => m.tier === this.tier);
    const statMultiplier = gameMode?.statMultiplier || 1;
    
    // Apply stat multiplier to starting length
    const baseStartingLength = Physics.STARTING_LENGTH;
    const startingLength = Math.floor(baseStartingLength * statMultiplier);

    // Create initial snake segments
    const segments = Physics.createInitialSegments(
      startX,
      startY,
      startAngle,
      startingLength
    );

    const snake: Snake = {
      id: playerId,
      playerId,
      segments,
      angle: startAngle,
      length: startingLength,
      velocity: { x: 0, y: 0 },
      color: this.randomColor(),
      isBoosting: false,
      lastBoostCostTime: Date.now(),
      headPath: [...segments], // Initialize with current segments
      targetX: startX,
      targetY: startY,
      spawnTime: Date.now(),
      statMultiplier, // Store multiplier for physics calculations
    };

    const player: Player = {
      id: playerId,
      socketId,
      name,
      snake,
      totalLength: startingLength,
      stats: {
        pelletsEaten: 0,
        cellsEaten: 0,
        maxLength: startingLength,
        leaderTime: 0,
        bestRank: 999,
        timeSurvived: 0,
      },
      joinTime: Date.now(),
      lastInputTime: Date.now(),
      isBot,
      walletAddress, // Store wallet address
      equippedCosmetics, // Store equipped cosmetics
    };

    this.players.set(playerId, player);
  }

  /**
   * Generate random color for snake
   */
  private randomColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
      '#F8B739', '#52B788', '#E63946', '#A8DADC'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Start game loop
   */
  start(): void {
    console.log(`Game ${this.id} (Tier: $${this.tier}) starting with ${this.players.size} players`);
    
    // Initialize apple based on tier and spawn rate
    this.initializeApple();
    
    const tickRate = config.server.tickRate;
    const tickInterval = 1000 / tickRate;

    this.tickInterval = setInterval(() => {
      this.tick();
    }, tickInterval);
  }

  /**
   * Main game tick (runs at 60Hz)
   */
  private tick(): void {
    const now = Date.now();
    const deltaTime = (now - this.gameState.lastTickTime) / 1000;
    this.gameState.lastTickTime = now;

    // Update shrinking safe zone
    if (config.game.shrinkingEnabled) {
      this.updateSafeZone();
      this.cleanPelletsOutsideBounds();
      this.checkAppleZoneSafety(); // Check if apple needs respawning
    }

    // Update all players
    for (const player of this.players.values()) {
      this.updatePlayer(player, deltaTime);
    }

    // Handle collisions
    this.handleCollisions();
    this.checkAppleCollisions(); // Check apple pickups

    // Damage players outside safe zone
    if (config.game.shrinkingEnabled) {
      this.handleSafeZoneDamage();
    }

    // Update stats
    this.updateStats(deltaTime);

    // Check win condition (only once per second to reduce overhead)
    if (now - this.lastWinCheckTime >= 1000) {
      this.checkWinCondition();
      this.lastWinCheckTime = now;
    }

    // Broadcast state (full state every 500ms, deltas otherwise)
    if (now % 500 < 20) {
      this.broadcastFullState();
    } else {
      this.broadcastDeltaState();
    }

    // Respawn pellets
    this.respawnPellets();
  }

  /**
   * Update shrinking map boundaries based on game time
   */
  private updateSafeZone(): void {
    const elapsed = Date.now() - this.gameStartTime;
    const progress = elapsed / this.maxDuration; // 0 to 1

    // Shrink from 0% to 90% of game time (leaves 10% for final battle)
    const shrinkProgress = Math.min(1, progress / 0.9); // 0 to 1, caps at 90% elapsed
    
    // Shrink map from full size to 10% of original (centered)
    const shrinkAmount = shrinkProgress * 0.9; // 0 to 0.9 (90% shrink, leaving 10%)
    const centerX = config.game.mapWidth / 2;
    const centerY = config.game.mapHeight / 2;
    const halfWidth = (config.game.mapWidth / 2) * (1 - shrinkAmount);
    const halfHeight = (config.game.mapHeight / 2) * (1 - shrinkAmount);
    
    this.currentMapBounds = {
      minX: centerX - halfWidth,
      maxX: centerX + halfWidth,
      minY: centerY - halfHeight,
      maxY: centerY + halfHeight,
    };
    
    // Log only every 10 seconds
    if (Math.floor(elapsed / 1000) % 10 === 0 && elapsed % 1000 < 100) {
      console.log(`🔴 Map: ${Math.floor(this.currentMapBounds.maxX - this.currentMapBounds.minX)}x${Math.floor(this.currentMapBounds.maxY - this.currentMapBounds.minY)} (${(progress * 100).toFixed(1)}% elapsed)`);
    }
  }

  /**
   * Handle players touching boundaries (3 second kill timer)
   */
  private handleSafeZoneDamage(): void {
    const now = Date.now();
    const BOUNDARY_MARGIN = 10; // How close is "touching"
    const KILL_TIME = 3000; // 3 seconds
    
    for (const player of this.players.values()) {
      const head = player.snake.segments[0];
      if (!head) continue;
      
      // Check if snake head is touching the boundary walls
      const touchingLeft = head.x - BOUNDARY_MARGIN <= this.currentMapBounds.minX;
      const touchingRight = head.x + BOUNDARY_MARGIN >= this.currentMapBounds.maxX;
      const touchingTop = head.y - BOUNDARY_MARGIN <= this.currentMapBounds.minY;
      const touchingBottom = head.y + BOUNDARY_MARGIN >= this.currentMapBounds.maxY;
      
      const isTouchingBoundary = touchingLeft || touchingRight || touchingTop || touchingBottom;
      
      if (isTouchingBoundary) {
        // Start or continue boundary timer
        if (!player.boundaryTouchTime) {
          player.boundaryTouchTime = now;
          console.log(`⚠️ ${player.name} touching boundary - 3s countdown started`);
          
          // Send warning to player
          const socket = Array.from(this.io.sockets.sockets.values()).find(s => s.id === player.socketId);
          if (socket) {
            socket.emit('boundaryWarning', { startTime: now });
          }
        }
        
        const timeOnBoundary = now - player.boundaryTouchTime;
        
        // Kill after 3 seconds
        if (timeOnBoundary >= KILL_TIME) {
          console.log(`💀 ${player.name} eliminated by boundary (3s timeout)`);
          this.killSnake(player.id, null);
          
          const socket = Array.from(this.io.sockets.sockets.values()).find(s => s.id === player.socketId);
          if (socket) {
            socket.emit('boundaryKilled');
          }
        }
      } else {
        // Moved away from boundary - reset timer
        if (player.boundaryTouchTime) {
          console.log(`✅ ${player.name} moved away from boundary`);
          player.boundaryTouchTime = undefined;
          
          const socket = Array.from(this.io.sockets.sockets.values()).find(s => s.id === player.socketId);
          if (socket) {
            socket.emit('boundarySafe');
          }
        }
      }
    }
  }

  /**
   * Update player snake
   */
  private updatePlayer(player: Player, deltaTime: number): void {
    const snake = player.snake;
    if (snake.segments.length === 0) return;

    // Update snake head movement
    Physics.moveSnakeHead(snake, deltaTime);

    // Update body segments to follow head
    Physics.updateSnakeBody(snake);

    // Clamp head to map boundaries
    const head = snake.segments[0];
    const radius = Physics.HEAD_RADIUS;
    const clamped = Physics.clampToMap(
      head.x,
      head.y,
      radius,
      config.game.mapWidth,
      config.game.mapHeight
    );
    head.x = clamped.x;
    head.y = clamped.y;

    // Handle boost cost
    if (snake.isBoosting) {
      const now = Date.now();
      const timeSinceLastCost = (now - snake.lastBoostCostTime) / 1000;
      
      if (timeSinceLastCost >= Physics.BOOST_COST_INTERVAL) {
        const removedSegments = Physics.removeSegments(snake, 1);
        if (removedSegments.length === 0) {
          // Can't boost anymore, stop boosting
          snake.isBoosting = false;
        } else {
          // Spawn pellets for each removed segment (1:1 ratio)
          this.spawnBoostPellets(removedSegments);
        }
        snake.lastBoostCostTime = now;
      }
    }

    player.totalLength = snake.length;

    // Update maxLength stat
    if (snake.length > player.stats.maxLength) {
      player.stats.maxLength = snake.length;
    }
  }

  /**
   * Handle all collisions using spatial hashing
   */
  private handleCollisions(): void {
    // Clear and rebuild spatial hash (for pellets only)
    this.spatialHash.clear();
    
    // Insert only pellets into spatial hash
    for (const pellet of this.pellets.values()) {
      this.spatialHash.insert(pellet);
    }

    // Check collisions
    for (const player of this.players.values()) {
      const snake = player.snake;
      if (snake.segments.length === 0) continue;

      const head = snake.segments[0];
      const nearby = this.spatialHash.getNearby(head.x, head.y);
      
      // Check head vs pellets
      for (const pellet of nearby) {
        this.handlePelletCollision(snake, pellet, player);
      }

      // Check head vs all snake bodies (including own body after delay)
      for (const otherPlayer of this.players.values()) {
        if (otherPlayer.snake.segments.length === 0) continue;

        // For own snake, check collision after spawn delay
        if (otherPlayer.id === player.id) {
          if (!Physics.canSelfCollide(snake, Date.now())) {
            continue; // Skip self-collision check during grace period
          }
        }

        // Check head vs body segments (skip head segment)
        this.checkHeadBodyCollision(player, otherPlayer);
      }
    }
  }

  /**
   * Check if a snake's head collides with another snake's body
   */
  private checkHeadBodyCollision(attacker: Player, defender: Player): void {
    // Safety check: ensure both snakes still have segments (snake could have died mid-iteration)
    if (!attacker.snake || !attacker.snake.segments || attacker.snake.segments.length === 0) return;
    if (!defender.snake || !defender.snake.segments || defender.snake.segments.length === 0) return;
    
    const attackerHead = attacker.snake.segments[0];
    const defenderBody = defender.snake.segments;

    // Check collision with each body segment pair (line segments)
    // In Slither.io, snakes cannot collide with themselves (only other snakes)
    if (attacker.id === defender.id) return; // Skip self-collision entirely
    
    const startIndex = 1; // Start from first body segment (skip head)
    
    for (let i = startIndex; i < defenderBody.length - 1; i++) {
      const seg1 = defenderBody[i];
      const seg2 = defenderBody[i + 1];
      
      // Safety check for segments
      if (!seg1 || !seg2) continue;

      if (Physics.checkHeadBodyCollision(
        attackerHead.x,
        attackerHead.y,
        Physics.HEAD_RADIUS,
        seg1.x,
        seg1.y,
        seg2.x,
        seg2.y,
        Physics.SEGMENT_RADIUS
      )) {
        // Attacker's head hit defender's body - attacker dies
        console.log(`💀 ${attacker.name} hit ${defender.name}'s body`);
        this.killSnake(attacker.id, defender.id);
        return;
      }
    }
  }

  /**
   * Handle snake eating pellet
   */
  private handlePelletCollision(snake: Snake, pellet: Pellet, player: Player): void {
    // Safety check: ensure snake still has segments
    if (!snake.segments || snake.segments.length === 0) return;
    
    const head = snake.segments[0];
    if (!head) return;
    
    if (Physics.checkPointCircleCollision(
      head.x,
      head.y,
      Physics.HEAD_RADIUS,
      pellet.x,
      pellet.y,
      4
    )) {
      // Add 1 segment to snake
      Physics.addSegments(snake, 1);
      player.stats.pelletsEaten++;
      this.pellets.delete(pellet.id);
    }
  }

  /**
   * Kill a snake and spawn pellets
   */
  private killSnake(victimId: string, killerId: string | null): void {
    const victim = this.players.get(victimId);
    if (!victim || victim.snake.segments.length === 0) return;

    // Check if victim is holding apple and drop it
    const apple = this.gameState.apple;
    if (apple && apple.heldBy === victimId) {
      const head = victim.snake.segments[0];
      if (head) {
        this.dropApple(head.x, head.y, victimId, 'death');
      }
    }

    // Award kill to killer
    if (killerId) {
      const killer = this.players.get(killerId);
      if (killer) {
        killer.stats.cellsEaten++;
      }
    }

    // Spawn pellets along snake body
    this.spawnDeathPellets(victim.snake);

    // Clear snake segments
    victim.snake.segments = [];
    victim.snake.length = 0;

    // Eliminate player
    this.eliminatePlayer(victimId);

    // Send death event
    const socket = Array.from(this.io.sockets.sockets.values()).find(s => s.id === victim.socketId);
    if (socket) {
      socket.emit('playerEliminated', {});
    }

    // Emit global game event for feed
    if (killerId) {
      const killer = this.players.get(killerId);
      this.io.emit('gameEvent', {
        type: 'elimination',
        victim: victim.name,
        killer: killer?.name || 'Unknown'
      });
    }

    console.log(`Snake ${victim.name} killed by ${killerId ? this.players.get(killerId)?.name : 'boundary/self'}`);
  }

  /**
   * Spawn pellets along dead snake's body
   */
  private spawnDeathPellets(snake: Snake): void {
    const pelletColors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
      '#F8B739', '#52B788', '#E63946', '#A8DADC'
    ];

    // Spawn pellets every N segments
    const pelletInterval = Math.floor(1 / Physics.PELLETS_PER_SEGMENT); // e.g., 0.5 = every 2 segments
    
    for (let i = 0; i < snake.segments.length; i += pelletInterval) {
      const segment = snake.segments[i];
      const spread = Physics.DEATH_PELLET_SPREAD;
      
      const pellet: Pellet = {
        id: `death_${Date.now()}_${i}_${Math.random()}`,
        x: segment.x + (Math.random() - 0.5) * spread * 2,
        y: segment.y + (Math.random() - 0.5) * spread * 2,
        mass: 1,
        color: pelletColors[Math.floor(Math.random() * pelletColors.length)],
      };
      this.pellets.set(pellet.id, pellet);
    }
  }

  /**
   * Spawn pellets from boost segments (1:1 ratio - each segment becomes one pellet)
   */
  private spawnBoostPellets(segments: SnakeSegment[]): void {
    const pelletColors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
      '#F8B739', '#52B788', '#E63946', '#A8DADC'
    ];

    // Create one pellet for each removed segment (1:1 ratio)
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const spread = 5; // Small spread so pellets are near the tail
      
      const pellet: Pellet = {
        id: `boost_${Date.now()}_${i}_${Math.random()}`,
        x: segment.x + (Math.random() - 0.5) * spread * 2,
        y: segment.y + (Math.random() - 0.5) * spread * 2,
        mass: 1,
        color: pelletColors[Math.floor(Math.random() * pelletColors.length)],
      };
      this.pellets.set(pellet.id, pellet);
    }
  }

  /**
   * Eliminate player from game
   */
  private eliminatePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.stats.timeSurvived = (Date.now() - player.joinTime) / 1000;
      console.log(`Player ${player.name} eliminated after ${player.stats.timeSurvived}s`);
      
      // Broadcast player count update to all lobbies
      this.io.emit('playerCountUpdate', {
        gameId: this.id,
        tier: this.tier,
      });
    }
  }

  /**
   * Update player stats
   */
  private updateStats(deltaTime: number): void {
    const leaderboard = this.getLeaderboard();
    
    for (let i = 0; i < leaderboard.length; i++) {
      const player = this.players.get(leaderboard[i].id);
      if (!player) continue;

      const rank = i + 1;

      // Update bestRank (lower is better)
      if (rank < player.stats.bestRank) {
        player.stats.bestRank = rank;
      }

      // Update leaderTime if player is #1
      if (rank === 1) {
        player.stats.leaderTime += deltaTime;
      }
    }
  }

  /**
   * Get current leaderboard
   */
  getLeaderboard(): LeaderboardEntry[] {
    return Array.from(this.players.values())
      .filter(p => p.snake.segments.length > 0)
      .map(p => ({
        id: p.id,
        name: p.name,
        length: p.totalLength,
        cellsEaten: p.stats.cellsEaten,
        rank: 0,
      }))
      .sort((a, b) => b.length - a.length)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  /**
   * Check win condition (called once per second)
   */
  private checkWinCondition(): void {
    const alivePlayers = Array.from(this.players.values()).filter(p => p.snake.segments.length > 0);
    const elapsed = Date.now() - this.gameStartTime;

    // Last player standing (ONLY if game started with multiple players)
    if (alivePlayers.length === 1 && this.players.size > 1) {
      console.log(`🏆 WIN: Last player standing (${alivePlayers[0].name})`);
      this.endGame(alivePlayers[0].id);
      return;
    }

    // Time limit reached
    if (elapsed >= this.maxDuration) {
      const leaderboard = this.getLeaderboard();
      const winner = leaderboard.length > 0 ? leaderboard[0] : null;
      console.log(`⏰ WIN: Time limit reached. Winner: ${winner?.name || 'None'} with ${winner?.length || 0} length`);
      this.endGame(winner?.id || null);
      return;
    }

    // No players left (all eliminated)
    if (alivePlayers.length === 0) {
      console.log('💀 WIN: No players left (draw)');
      this.endGame(null);
    }
  }

  /**
   * Handle apple reward distribution at game end
   */
  private handleAppleRewards(winnerId: string | null): void {
    const apple = this.gameState.apple;
    if (!apple) {
      console.log(`🍎 No apple spawned this game - no rewards`);
      return; // No apple this game
    }
    
    let rewardPlayerId: string | null = null;
    let rewardReason: 'held_at_end' | 'killed_holder' = 'held_at_end';
    
    // Primary condition: Someone is holding the apple at game end
    if (apple.heldBy) {
      const holder = this.players.get(apple.heldBy);
      if (holder) {
        rewardPlayerId = apple.heldBy;
        rewardReason = 'held_at_end';
        console.log(`🍎 ${holder.name} held apple at game end - receives +1 apple`);
      }
    }
    // Secondary condition: Winner killed the apple holder
    else if (winnerId && this.lastAppleHolderId && winnerId !== this.lastAppleHolderId) {
      const winner = this.players.get(winnerId);
      const lastHolder = this.players.get(this.lastAppleHolderId);
      
      // Check if last holder is dead (winner killed them)
      if (lastHolder && lastHolder.snake.segments.length === 0) {
        rewardPlayerId = winnerId;
        rewardReason = 'killed_holder';
        console.log(`🍎 ${winner?.name} killed apple holder - receives +1 apple`);
      }
    }
    
    // Award apple to the determined player
    if (rewardPlayerId) {
      const rewardPlayer = this.players.get(rewardPlayerId);
      if (rewardPlayer && rewardPlayer.walletAddress) {
        console.log(`🍎 Awarding apple to ${rewardPlayer.name} (${rewardPlayer.walletAddress})`);
        
        // Trigger apple reward callback if provided
        if (this.onAppleReward) {
          this.onAppleReward(rewardPlayerId, rewardPlayer.walletAddress, rewardReason)
            .then(() => {
              // Notify player of reward
              const socket = Array.from(this.io.sockets.sockets.values()).find(s => s.id === rewardPlayer.socketId);
              if (socket) {
                socket.emit('appleRewarded', {
                  playerId: rewardPlayerId,
                  newBalance: -1, // Will be updated by server after DB write
                  reason: rewardReason,
                });
              }
            })
            .catch(error => {
              console.error(`❌ Failed to award apple to ${rewardPlayer.name}:`, error);
            });
        }
      } else {
        console.log(`⚠️ Apple reward player has no wallet address - no reward given`);
      }
    } else {
      console.log(`🍎 No apple reward this game (apple was free at game end)`);
    }
  }

  /**
   * End game and calculate results
   */
  private endGame(winnerId: string | null): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Finalize timeSurvived for all players
    for (const player of this.players.values()) {
      if (player.snake.segments.length > 0) {
        player.stats.timeSurvived = (Date.now() - player.joinTime) / 1000;
      }
    }

    // Calculate final rankings with tie-breakers
    const rankings = Array.from(this.players.values())
      .map(p => ({
        id: p.id,
        name: p.name,
        length: p.totalLength,
        timeSurvived: p.stats.timeSurvived,
        cellsEaten: p.stats.cellsEaten,
        pelletsEaten: p.stats.pelletsEaten,
      }))
      .sort((a, b) => {
        // Primary: timeSurvived (last alive wins)
        if (b.timeSurvived !== a.timeSurvived) return b.timeSurvived - a.timeSurvived;
        // Tie-breaker 1: length
        if (b.length !== a.length) return b.length - a.length;
        // Tie-breaker 2: cellsEaten
        if (b.cellsEaten !== a.cellsEaten) return b.cellsEaten - a.cellsEaten;
        // Tie-breaker 3: pelletsEaten
        return b.pelletsEaten - a.pelletsEaten;
      });

    // Collect all player stats
    const playerStats: Record<string, PlayerStats> = {};
    for (const player of this.players.values()) {
      playerStats[player.id] = { ...player.stats };
    }

    const result: GameEndResult = {
      winnerId,
      finalRankings: rankings,
      playerStats,
    };

    // Handle apple rewards before broadcasting game end
    this.handleAppleRewards(winnerId);

    // Broadcast game end
    this.io.to(this.id).emit('gameEnd', result);
    
    // Emit global win event for feed
    if (winnerId) {
      const winner = this.players.get(winnerId);
      if (winner) {
        const tierNum = this.tier === 'whale' ? 500 : parseInt(this.tier);
        const prize = Math.floor(tierNum * this.players.size * 0.8);
        
        this.io.emit('gameEvent', {
          type: 'win',
          winner: winner.name,
          prize: prize,
          players: this.players.size
        });
      }
    }
    
    console.log(`🏁 GAME END: ${this.id}`);
    console.log(`   Winner: ${winnerId ? this.players.get(winnerId)?.name : 'None'} (${winnerId || 'N/A'})`);
    console.log(`   Duration: ${((Date.now() - this.gameStartTime) / 1000).toFixed(1)}s`);
    console.log(`   Total players: ${this.players.size}`);
    
    // Store winner info for session tracking
    if (winnerId) {
      const winner = this.players.get(winnerId);
      if (winner) {
        this.lastWinnerId = winnerId;
        this.lastWinnerName = winner.name;
        this.lastWinnerWallet = winner.walletAddress;
      }
    }
    
    // Trigger winner payout/distribution if callback provided
    if (winnerId && this.onWinnerDetermined) {
      const winner = this.players.get(winnerId);
      if (winner) {
        let actualWinnerId = winnerId;
        let actualWinnerName = winner.name;
        
        // If bot won, find the best human player for payout
        if (winner.isBot) {
          console.log(`🤖 Bot won (${winner.name}) - finding best human player for payout...`);
          
          // Find first human in rankings (already sorted by timeSurvived, length, kills)
          const bestHuman = rankings.find(r => {
            const player = this.players.get(r.id);
            return player && !player.isBot;
          });
          
          if (bestHuman) {
            const humanPlayer = this.players.get(bestHuman.id);
            if (humanPlayer) {
              actualWinnerId = bestHuman.id;
              actualWinnerName = humanPlayer.name;
              console.log(`   ✅ Best human found: ${humanPlayer.name} (rank #${rankings.findIndex(r => r.id === bestHuman.id) + 1})`);
              console.log(`   💰 Payout will go to: ${humanPlayer.name}`);
            }
          } else {
            console.error(`   ❌ No human players found in game! This should not happen.`);
            return; // Don't trigger payout if no humans
          }
        } else {
          console.log(`💰 Human player won - triggering payout for ${winner.name}`);
        }
        
        // Trigger callback with actual winner (human, even if bot won the game)
        this.onWinnerDetermined(actualWinnerId, actualWinnerName, this.id, this.sessionId || this.id, this.tier, this.players.size)
          .catch(error => {
            console.error(`❌ PAYOUT FAILED for ${actualWinnerName}:`, error);
          });
      }
    }
    
    // Clear spectators immediately since game is over
    console.log(`Clearing ${this.gameState.spectators.size} spectators from ended game`);
    this.gameState.spectators.clear();
    
    // Stop the game IMMEDIATELY (clears all state including tick loop)
    this.stop();
    
    // Call lobby manager callback to remove game and reset lobby
    if (this.onGameEnd) {
      this.onGameEnd();
    }
  }

  /**
   * Clean pellets outside bounds
   */
  private cleanPelletsOutsideBounds(): void {
    for (const [id, pellet] of this.pellets.entries()) {
      if (pellet.x < this.currentMapBounds.minX || pellet.x > this.currentMapBounds.maxX ||
          pellet.y < this.currentMapBounds.minY || pellet.y > this.currentMapBounds.maxY) {
        this.pellets.delete(id);
      }
    }
  }

  /**
   * Respawn pellets to maintain count (only within current map bounds)
   */
  private respawnPellets(): void {
    // CHRISTMAS THEME: All pellets are white (snow on ground)
    const target = config.game.pelletCount;
    const current = this.pellets.size;

    // Spawn new pellets ONLY within current bounds
    const MARGIN = 100;
    for (let i = 0; i < target - current; i++) {
      const pellet: Pellet = {
        id: `pellet_${Date.now()}_${i}`,
        x: this.currentMapBounds.minX + MARGIN + Math.random() * (this.currentMapBounds.maxX - this.currentMapBounds.minX - MARGIN * 2),
        y: this.currentMapBounds.minY + MARGIN + Math.random() * (this.currentMapBounds.maxY - this.currentMapBounds.minY - MARGIN * 2),
        mass: 1,
        color: '#FFFFFF', // White for snow effect
      };
      this.pellets.set(pellet.id, pellet);
    }
  }

  /**
   * Broadcast full game state
   */
  private broadcastFullState(): void {
    const snakes = [];
    for (const player of this.players.values()) {
      if (player.snake.segments.length > 0) {
        snakes.push({
          id: player.snake.id,
          playerId: player.snake.playerId,
          segments: player.snake.segments,
          angle: player.snake.angle,
          length: player.snake.length,
          color: player.snake.color,
          isBoosting: player.snake.isBoosting,
          name: player.name,
          equippedCosmetics: player.equippedCosmetics || {},
        });
      }
    }

    const pelletsArray = Array.from(this.pellets.values()).map(p => ({
      x: p.x,
      y: p.y,
      color: p.color,
    }));

    const leaderboard = this.getLeaderboard().slice(0, 10);

    const timeRemaining = Math.max(0, this.maxDuration - (Date.now() - this.gameStartTime));

    // Prepare apple data for clients
    let appleData = null;
    if (this.gameState.apple) {
      appleData = {
        id: this.gameState.apple.id,
        x: this.gameState.apple.x,
        y: this.gameState.apple.y,
        heldBy: this.gameState.apple.heldBy,
      };
    }

    this.io.to(this.id).emit('gameState', {
      snakes,
      pellets: pelletsArray,
      leaderboard,
      spectatorCount: this.gameState.spectators.size,
      mapBounds: config.game.shrinkingEnabled ? this.currentMapBounds : null,
      timeRemaining, // Milliseconds remaining
      apple: appleData, // Include apple state
    });
  }

  /**
   * Broadcast delta state (only changed entities)
   */
  private broadcastDeltaState(): void {
    // For Phase 1, we'll just broadcast full state
    // Delta optimization can be added later
    this.broadcastFullState();
  }

  /**
   * Handle player movement input
   */
  handlePlayerMove(playerId: string, targetX: number, targetY: number): void {
    const player = this.players.get(playerId);
    if (!player) {
      console.warn(`Player ${playerId} not found in game ${this.id}`);
      return;
    }

    // ANTI-CHEAT: Validate coordinates are within map bounds + buffer
    const mapSize = config.game.mapWidth;
    const buffer = mapSize * 0.5;
    if (targetX < -buffer || targetX > mapSize + buffer || targetY < -buffer || targetY > mapSize + buffer) {
      console.warn(`⚠️ ANTI-CHEAT: ${player.name} sent out-of-bounds coordinates (${Math.floor(targetX)}, ${Math.floor(targetY)}) - clamping`);
      targetX = Math.max(-buffer, Math.min(mapSize + buffer, targetX));
      targetY = Math.max(-buffer, Math.min(mapSize + buffer, targetY));
    }

    player.lastInputTime = Date.now();

    // Update snake target position
    player.snake.targetX = targetX;
    player.snake.targetY = targetY;
  }

  /**
   * Handle player boost toggle
   */
  handlePlayerBoost(playerId: string, boosting: boolean): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Check if snake is long enough to boost
    if (boosting && player.snake.length <= Physics.MIN_BOOST_LENGTH) {
      boosting = false;
    }

    player.snake.isBoosting = boosting;
  }

  /**
   * Stop game and clean up resources
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    
    // Clear all game state
    this.players.clear();
    this.pellets.clear();
    this.spatialHash.clear();
    this.gameState.spectators.clear();
    
    console.log(`🛑 Game ${this.id} stopped and cleaned up`);
  }
  
  /**
   * Get game ID for cleanup
   */
  getId(): string {
    return this.id;
  }
}
