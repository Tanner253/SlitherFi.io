import { Server } from 'socket.io';
import { Lobby, Player } from './types.js';
import { config } from './config.js';
import { GameRoom } from './gameRoom.js';
import { BotManager } from './botManager.js';

export class LobbyManager {
  private lobbies: Map<string, Lobby>;
  private games: Map<string, GameRoom>;
  private io: Server;
  private botManager: BotManager;
  private onWinnerDetermined?: (winnerId: string, winnerName: string, gameId: string, sessionId: string, tier: string, playersCount: number) => Promise<void>;
  private onLobbyReset?: (playerIds: string[]) => void;
  private dreamLastGameEnd: number = 0; // Track when last Dream game ended
  private entryFeeService?: any; // Reference to entry fee service for pot calculation
  private isInitialized: boolean = false; // Track if DB data is loaded

  constructor(io: Server) {
    this.lobbies = new Map();
    this.games = new Map();
    this.io = io;
    this.botManager = new BotManager();

    // Initialize lobbies for each game mode
    this.initializeLobbies();
    
    // Load Dream timer from DB (async, but constructor can't await)
    // This will load in the background before first join attempt
    this.loadDreamTimer().catch(err => {
      console.error('Failed to load Dream timer:', err);
    });
  }
  
  /**
   * Initialize the LobbyManager (call this after construction to ensure DB is loaded)
   */
  async initialize(): Promise<void> {
    // Load Dream timer from database before accepting players
    await this.loadDreamTimer();
    this.isInitialized = true;
    console.log('✅ LobbyManager initialized - ready to accept players');
    
    // Log Dream Mode availability status
    if (this.isDreamOnCooldown()) {
      const remainingMs = this.getDreamCooldownRemaining();
      const remainingMins = Math.ceil(remainingMs / (1000 * 60));
      console.log(`   ☁️  Dream Mode: ON COOLDOWN (${remainingMins} min remaining)`);
    } else {
      console.log('   ☁️  Dream Mode: AVAILABLE for players to join');
    }
  }

  /**
   * Load Dream timer from database
   */
  private async loadDreamTimer(): Promise<void> {
    try {
      // Check if mongoose is connected
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        console.log('⚠️ MongoDB not connected yet - Dream Mode will be HIDDEN until DB loads');
        console.log('   Players cannot join Dream Mode until database confirms cooldown status');
        this.dreamLastGameEnd = 0; // Default value (ignored until DB loads)
        return;
      }

      const { DreamTimer } = await import('./models/DreamTimer.js');
      const timer = await (DreamTimer as any).findOne({ id: 'global' });
      if (timer && timer.lastGameEnd) {
        this.dreamLastGameEnd = timer.lastGameEnd;
        const hoursSince = (Date.now() - timer.lastGameEnd) / (1000 * 60 * 60);
        const minutesRemaining = this.getDreamCooldownRemaining() / (1000 * 60);
        
        console.log(`☁️ Dream timer loaded from DB:`);
        console.log(`   Last game ended: ${new Date(timer.lastGameEnd).toISOString()}`);
        console.log(`   Time since: ${hoursSince.toFixed(2)} hours ago`);
        
        if (this.isDreamOnCooldown()) {
          console.log(`   Status: ON COOLDOWN (${Math.ceil(minutesRemaining)} min remaining)`);
        } else {
          console.log(`   Status: AVAILABLE`);
        }
      } else {
        console.log('☁️ No Dream timer found in DB - First time setup (no previous games)');
        this.dreamLastGameEnd = 0; // No cooldown for first game ever
      }
    } catch (error) {
      console.error('⚠️ Failed to load Dream timer:', error);
      console.error('   Dream Mode will be HIDDEN until this is resolved');
      this.dreamLastGameEnd = 0;
    }
  }

  /**
   * Save Dream timer to database
   */
  private async saveDreamTimer(): Promise<void> {
    try {
      // Check if mongoose is connected
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        console.warn('⚠️ MongoDB not connected - cannot save Dream timer');
        return;
      }

      const { DreamTimer } = await import('./models/DreamTimer.js');
      await (DreamTimer as any).findOneAndUpdate(
        { id: 'global' },
        { lastGameEnd: this.dreamLastGameEnd, updatedAt: new Date() },
        { upsert: true }
      );
      console.log('💾 Dream timer saved to DB');
    } catch (error) {
      console.error('❌ Failed to save Dream timer:', error);
    }
  }

  /**
   * Set winner payout callback
   */
  setWinnerPayoutCallback(callback: (winnerId: string, winnerName: string, gameId: string, sessionId: string, tier: string, playersCount: number) => Promise<void>): void {
    this.onWinnerDetermined = callback;
  }

  /**
   * Set lobby reset callback (for clearing IP tracking)
   */
  setLobbyResetCallback(callback: (playerIds: string[]) => void): void {
    this.onLobbyReset = callback;
  }

  /**
   * Set apple reward callback
   */
  setAppleRewardCallback(callback: (playerId: string, walletAddress: string, reason: 'held_at_end' | 'killed_holder') => Promise<void>): void {
    // Set callback on all existing games
    for (const game of this.games.values()) {
      game.onAppleReward = callback;
    }
    
    // Store callback for future games
    this.onAppleReward = callback;
  }

  private onAppleReward?: (playerId: string, walletAddress: string, reason: 'held_at_end' | 'killed_holder') => Promise<void>;

  /**
   * Set cheat detection callback
   */
  setCheatDetectionCallback(callback: (playerId: string, playerName: string, reason: string) => void): void {
    this['onCheatDetected'] = callback;
  }

  /**
   * Set entry fee service reference (for pot calculation)
   */
  setEntryFeeService(service: any): void {
    this.entryFeeService = service;
  }

  /**
   * Add to lobby pot (when player pays entry fee)
   */
  addToPot(tier: string, amount: number): void {
    const lobbyId = `lobby_${tier}`;
    const lobby = this.lobbies.get(lobbyId);
    if (lobby) {
      lobby.potSize = (lobby.potSize || 0) + amount;
      console.log(`💰 Pot updated for ${tier}: $${lobby.potSize}`);
      this.broadcastSingleLobbyUpdate(lobby);
    }
  }

  /**
   * Remove from lobby pot (when player gets refund)
   */
  removeFromPot(tier: string, amount: number): void {
    const lobbyId = `lobby_${tier}`;
    const lobby = this.lobbies.get(lobbyId);
    if (lobby) {
      lobby.potSize = Math.max(0, (lobby.potSize || 0) - amount);
      console.log(`💸 Pot decreased for ${tier}: $${lobby.potSize}`);
      this.broadcastSingleLobbyUpdate(lobby);
    }
  }

  /**
   * Get current pot size for a lobby
   */
  getPotSize(tier: string): number {
    const lobbyId = `lobby_${tier}`;
    const lobby = this.lobbies.get(lobbyId);
    return lobby?.potSize || 0;
  }

  /**
   * Create game session record for auditing
   */
  private async createGameSession(
    gameId: string, 
    tier: string, 
    humanPlayers: number, 
    botPlayers: number,
    participants: string[],
    potSize: number
  ): Promise<void> {
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const { GameSession } = await import('./models/GameSession.js');
      
      await (GameSession as any).create({
        gameId,
        lobbyId: gameId, // Same as gameId for now
        tier,
        startTime: Date.now(),
        status: 'active',
        totalPlayers: humanPlayers + botPlayers,
        humanPlayers,
        botPlayers,
        participants,
        potSize
      });

      console.log(`📝 Game session logged: ${gameId} (${humanPlayers}H + ${botPlayers}B, Pot: $${potSize})`);
    } catch (error) {
      console.error('❌ Error creating game session:', error);
    }
  }

  /**
   * Complete game session record
   */
  private async completeGameSession(
    gameId: string, 
    winnerId: string, 
    winnerName: string,
    winnerWallet?: string
  ): Promise<void> {
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const { GameSession } = await import('./models/GameSession.js');
      
      const session = await (GameSession as any).findOne({ gameId });
      if (session) {
        const duration = Date.now() - session.startTime;
        await (GameSession as any).findOneAndUpdate(
          { gameId },
          {
            endTime: Date.now(),
            status: 'completed',
            winnerId,
            winnerName,
            winnerWallet,
            duration,
          }
        );
        console.log(`📝 Game session completed: ${gameId} (${(duration / 1000).toFixed(1)}s)`);
      }
    } catch (error) {
      console.error('❌ Error completing game session:', error);
    }
  }

  /**
   * Check for active session and mark as cancelled if server restarted
   */
  private async checkForActiveSession(lobbyId: string): Promise<void> {
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const { GameSession } = await import('./models/GameSession.js');
      
      // Find any active sessions for this lobby
      const activeSessions = await (GameSession as any).find({
        lobbyId,
        status: 'active'
      });

      if (activeSessions.length > 0) {
        console.log(`⚠️  Found ${activeSessions.length} orphaned active session(s) for ${lobbyId}`);
        
        // Mark them as cancelled (server must have restarted mid-game)
        for (const session of activeSessions) {
          await (GameSession as any).findByIdAndUpdate(session._id, {
            status: 'cancelled',
            endTime: Date.now(),
            duration: Date.now() - session.startTime,
          });
          console.log(`   Marked ${session.gameId} as cancelled (orphaned)`);
        }
      }
    } catch (error) {
      console.error('❌ Error checking active sessions:', error);
    }
  }

  /**
   * Initialize lobbies for all game modes
   */
  private initializeLobbies(): void {
    for (const mode of config.gameModes) {
      if (mode.locked) continue; // Skip Whale Mode for now

      const lobby: Lobby = {
        id: `lobby_${mode.tier}`,
        tier: mode.tier,
        players: new Map(),
        spectators: new Set(),
        status: 'waiting',
        countdownStartTime: null,
        gameStartTime: null,
        maxPlayers: mode.maxPlayers,
        potSize: 0,
      };

      this.lobbies.set(lobby.id, lobby);
    }
  }

  /**
   * Get all lobbies status
   */
  getLobbiesStatus() {
    return Array.from(this.lobbies.values())
      .filter(lobby => {
        // Filter out Dream mode if not initialized (DB not loaded yet)
        if (lobby.tier === 'dream' && !this.isInitialized) {
          return false;
        }
        return true;
      })
      .map(lobby => {
      // Get game if playing
      const game = lobby.status === 'playing' ? this.games.get(lobby.id) : null;
      const spectatorCount = game ? game.gameState.spectators.size : lobby.spectators.size;
      
      let realPlayerCount = 0;
      let botCount = 0;
      
      if (game && lobby.status === 'playing') {
        // Count alive players and bots in active game
        for (const player of game.players.values()) {
          if (player.snake && player.snake.segments.length > 0) {
            if (player.isBot) {
              botCount++;
            } else {
              realPlayerCount++;
            }
          }
        }
      } else {
        // Count players in lobby
        for (const player of lobby.players.values()) {
          if (player.isBot) {
            botCount++;
          } else {
            realPlayerCount++;
          }
        }
      }
      
      return {
        id: lobby.id,
        tier: lobby.tier,
      playersCount: realPlayerCount + botCount,
      playersLocked: realPlayerCount + botCount, // Added for client compatibility
      realPlayerCount,
        botCount,
        maxPlayers: lobby.maxPlayers,
        status: lobby.status,
        spectatorCount,
        countdown: lobby.countdownStartTime 
          ? Math.max(0, Math.floor((config.lobby.autoStartCountdown - (Date.now() - lobby.countdownStartTime)) / 1000))
          : null,
      };
    });
  }

  /**
   * Join player to lobby
   */
  async joinLobby(socketId: string, playerId: string, playerName: string, tier: string, walletAddress?: string): Promise<{ success: boolean; message?: string }> {
    const lobbyId = `lobby_${tier}`;
    const lobby = this.lobbies.get(lobbyId);

    if (!lobby) {
      return { success: false, message: 'Invalid game mode' };
    }

    // Check if LobbyManager is initialized (DB loaded) for Dream mode
    if (tier === 'dream' && !this.isInitialized) {
      return { success: false, message: 'Server is starting up. Please wait a moment and try again.' };
    }

    // Check Dream tier cooldown
    if (tier === 'dream' && this.isDreamOnCooldown()) {
      const remainingMs = this.getDreamCooldownRemaining();
      const remainingMins = Math.ceil(remainingMs / (1000 * 60));
      return { success: false, message: `Dream Mode on cooldown. Next game in ${remainingMins} minutes.` };
    }

    if (lobby.status === 'playing') {
      return { success: false, message: 'Game in progress - join as spectator instead' };
    }

    if (lobby.status !== 'waiting' && lobby.status !== 'countdown') {
      return { success: false, message: 'Lobby not available' };
    }

    // Check if player already in another lobby
    for (const l of this.lobbies.values()) {
      if (l.players.has(playerId)) {
        return { success: false, message: 'Already in a lobby' };
      }
    }

    // During countdown, replace a bot if lobby is full
    if (lobby.players.size >= lobby.maxPlayers) {
      if (lobby.status === 'countdown') {
        // Find and remove a bot
        const botToReplace = Array.from(lobby.players.values()).find(p => p.isBot);
        if (botToReplace) {
          lobby.players.delete(botToReplace.id);
          console.log(`Replaced bot ${botToReplace.name} with player ${playerName}`);
        } else {
          return { success: false, message: 'Lobby is full' };
        }
      } else {
        return { success: false, message: 'Lobby is full' };
      }
    }

    // Join socket to lobby room for updates
    const socket = Array.from(this.io.sockets.sockets.values()).find(s => s.id === socketId);
    if (socket) {
      socket.join(lobbyId);
    }

    // Fetch player's equipped cosmetics if they have a wallet
    let equippedCosmetics = {};
    if (walletAddress) {
      try {
        const { cosmeticsService } = await import('./cosmeticsService.js');
        const cosmeticsData = await cosmeticsService.getUserCosmetics(walletAddress);
        if (cosmeticsData.success) {
          equippedCosmetics = cosmeticsData.equippedCosmetics || {};
        }
      } catch (error) {
        console.error('Failed to fetch player cosmetics:', error);
      }
    }

    // Add player to lobby
    lobby.players.set(playerId, {
      id: playerId,
      socketId,
      name: playerName,
      snake: null,
      totalLength: 0,
      stats: {
        pelletsEaten: 0,
        cellsEaten: 0,
        maxLength: 0,
        leaderTime: 0,
        bestRank: 999,
        timeSurvived: 0,
      },
      joinTime: Date.now(),
      lastInputTime: Date.now(),
      isBot: false,
      walletAddress, // Store wallet address for history
      equippedCosmetics, // Store equipped cosmetics
    });

    console.log(`Player ${playerName} joined ${tier} lobby (${lobby.players.size}/${lobby.maxPlayers})`);

    // For free games (Dream Mode), track gamesPlayed immediately on join
    if (tier === 'dream' && walletAddress) {
      this.updateUserStatsForFreeGame(walletAddress, playerName).catch(err => {
        console.error('Failed to update user stats for free game:', err);
      });
    }

    // Immediately broadcast lobby update
    this.broadcastSingleLobbyUpdate(lobby);

    // Check if we should start countdown
    this.checkLobbyCountdown(lobby);

    return { success: true };
  }

  /**
   * Update user stats for free games (Dream Mode)
   */
  private async updateUserStatsForFreeGame(walletAddress: string, playerName: string): Promise<void> {
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const { User } = await import('./models/User.js');
      
      await (User as any).findOneAndUpdate(
        { walletAddress },
        {
          $inc: { gamesPlayed: 1 },
          $set: { username: playerName, lastActive: new Date() },
          $setOnInsert: { totalWinnings: 0, totalWagered: 0, gamesWon: 0 }
        },
        { upsert: true }
      );
      
      console.log(`📊 User stats updated: ${playerName} (+1 free game)`);
    } catch (error) {
      console.error('❌ Error updating user stats for free game:', error);
    }
  }

  /**
   * Add bots to lobby (HARDCODED: Always add 5 bots when game starts)
   */
  private fillWithBots(lobby: Lobby): void {
    const currentBotCount = Array.from(lobby.players.values()).filter(p => p.isBot).length;
    
    // HARDCODED: Always add exactly 5 bots total
    const targetBotCount = 5;
    const needed = targetBotCount - currentBotCount;
    
    if (needed <= 0) return; // Already have 5 or more bots
    
    // SAFEGUARD: Don't fill if game already exists or not waiting
    if (this.games.has(lobby.id) || lobby.status !== 'waiting') {
      return;
    }
    
    // Available cosmetics - bots can use ANY cosmetic
    const trails = ['trail_basic_glow', 'trail_rainbow', 'trail_fire', 'trail_lightning', 'trail_shadow'];
    const headItems = ['head_party_hat', 'head_halo', 'head_sunglasses', 'head_crown', 'head_devil_horns'];
    const nameStyles = ['name_rainbow', 'name_gold_glow', 'name_neon_pulse', 'name_fire', 'name_ice'];
    
    for (let i = 0; i < needed; i++) {
      const botId = `bot_${Date.now()}_${i}`;
      const botName = `Bot ${currentBotCount + i + 1}`;
      
      // Randomly assign cosmetics from any available option
      const randomCosmetics: any = {
        trail: trails[Math.floor(Math.random() * trails.length)],
        headItem: headItems[Math.floor(Math.random() * headItems.length)],
        nameStyle: nameStyles[Math.floor(Math.random() * nameStyles.length)],
      };

      lobby.players.set(botId, {
        id: botId,
        socketId: '',
        name: botName,
        snake: null,
        totalLength: 0,
        stats: {
          pelletsEaten: 0,
          cellsEaten: 0,
          maxLength: 0,
          leaderTime: 0,
          bestRank: 999,
          timeSurvived: 0,
        },
        joinTime: Date.now(),
        lastInputTime: Date.now(),
        isBot: true,
        equippedCosmetics: randomCosmetics,
      });
    }

    console.log(`✅ HARDCODED: Added ${needed} bots to ${lobby.tier} (Total bots now: ${targetBotCount})`);
  }

  /**
   * Check if lobby should start countdown
   */
  private checkLobbyCountdown(lobby: Lobby): void {
    // SAFEGUARD: Don't start countdown if game already exists
    if (this.games.has(lobby.id)) {
      console.log(`⚠️ Game ${lobby.id} already exists - skipping countdown`);
      return;
    }
    
    // SAFEGUARD: Only start from 'waiting' status
    if (lobby.status !== 'waiting') {
      return;
    }
    
    // In dev mode with MIN_PLAYERS_DEV=1, start immediately
    if (config.lobby.minPlayers === 1 && lobby.players.size >= 1 && lobby.tier !== 'dream') {
      console.log(`Dev mode: Starting game immediately with ${lobby.players.size} player(s)`);
      this.startGame(lobby).catch(err => console.error('Failed to start game:', err));
      return;
    }

    // Dream Mode uses different min players rule if configured
    const minPlayers = lobby.tier === 'dream' ? config.dream.minPlayers : config.lobby.minPlayers;

    if (lobby.players.size >= minPlayers) {
      lobby.status = 'countdown';
      lobby.countdownStartTime = Date.now();

      console.log(`Lobby ${lobby.id} countdown started (${lobby.players.size}/${lobby.maxPlayers})`);

      // Start countdown timer
      setTimeout(async () => {
        // Double-check before starting
        if (lobby.status === 'countdown' && !this.games.has(lobby.id)) {
          await this.startGame(lobby);
        } else {
          console.log(`⚠️ Countdown finished but lobby ${lobby.id} status is ${lobby.status} or game exists - skipping start`);
        }
      }, config.lobby.autoStartCountdown);
    }
  }

  /**
   * Check if Dream tier is on cooldown
   */
  private isDreamOnCooldown(): boolean {
    if (!config.dream.enabled) return false;
    
    const hoursSinceLastGame = (Date.now() - this.dreamLastGameEnd) / (1000 * 60 * 60);
    return hoursSinceLastGame < config.dream.intervalHours;
  }

  /**
   * Get time remaining until next Dream game (in milliseconds)
   */
  private getDreamCooldownRemaining(): number {
    if (!this.dreamLastGameEnd) return 0;
    
    const cooldownMs = config.dream.intervalHours * 60 * 60 * 1000;
    const elapsed = Date.now() - this.dreamLastGameEnd;
    return Math.max(0, cooldownMs - elapsed);
  }

  /**
   * Start game from lobby
   */
  private async startGame(lobby: Lobby): Promise<void> {
    // Check if still have minimum players
    const minPlayers = lobby.tier === 'dream' ? config.dream.minPlayers : config.lobby.minPlayers;
    
    if (lobby.players.size < minPlayers) {
      console.log(`Lobby ${lobby.id} cancelled - insufficient players`);
      lobby.status = 'waiting';
      lobby.countdownStartTime = null;
      this.io.to(lobby.id).emit('lobbyCancelled', { message: 'Not enough players' });
      return;
    }

    // SAFEGUARD: Don't start if a game already exists for this lobby
    if (this.games.has(lobby.id)) {
      console.log(`⚠️ Game ${lobby.id} already exists - aborting start`);
      console.log(`   Only 1 game per tier allowed at a time`);
      return;
    }
    
    // SAFEGUARD: Only start from 'waiting' or 'countdown' status
    if (lobby.status !== 'waiting' && lobby.status !== 'countdown') {
      console.log(`⚠️ Lobby ${lobby.id} status is ${lobby.status} - aborting start`);
      return;
    }
    
    // SAFEGUARD: Check database for active session (in case server restarted)
    await this.checkForActiveSession(lobby.id);

    // HARDCODED: Add 5 bots to every game when it starts
    this.fillWithBots(lobby);
    console.log(`✅ Added 5 bots to ${lobby.id} before game start`);

    lobby.status = 'playing';
    lobby.gameStartTime = Date.now();
    
    const humanPlayers = Array.from(lobby.players.values()).filter(p => !p.isBot);
    const botPlayers = Array.from(lobby.players.values()).filter(p => p.isBot);
    
    // Collect participant wallet addresses
    const participants = humanPlayers
      .map(p => p.walletAddress)
      .filter((addr): addr is string => !!addr);

    // Generate unique session ID for database auditing (lobby ID + timestamp)
    const sessionId = `${lobby.id}_${Date.now()}`;
    
    // Create game session record in database for auditing (use unique sessionId)
    this.createGameSession(
      sessionId, 
      lobby.tier, 
      humanPlayers.length, 
      botPlayers.length,
      participants,
      lobby.potSize || 0
    );
    
    console.log(`✅ STARTING GAME ${lobby.id}`);
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Tier: ${lobby.tier}`);
    console.log(`   Players: ${humanPlayers.length} human, ${botPlayers.length} bots`);
    console.log(`   Human players: ${humanPlayers.map(p => p.name).join(', ')}`);

    // Create game room (use lobby.id so safeguards work - only 1 game per tier)
    const game = new GameRoom(lobby.id, lobby.tier, this.io);
    game.sessionId = sessionId; // Store unique session ID for database
    
    // Set apple reward callback if available
    if (this.onAppleReward) {
      game.onAppleReward = this.onAppleReward;
    }
    
    // Override game duration for Dream tier
    if (lobby.tier === 'dream') {
      game.maxDuration = config.dream.gameDuration;
      console.log(`   Game duration: ${config.dream.gameDuration / 1000 / 60} minutes`);
    }

    // Add all players to game
    for (const player of lobby.players.values()) {
      game.addPlayer(player.socketId, player.id, player.name, player.isBot, player.walletAddress, player.equippedCosmetics);
      
      // If bot, start AI behavior
      if (player.isBot) {
        this.botManager.addBot(player.id, game);
      }
    }

    this.games.set(game.id, game);

    // Start game
    game.start();

    // Emit game start
    this.io.to(lobby.id).emit('gameStart', { startTime: game.gameStartTime, gameId: game.id });

    // Emit global game start event for feed
    this.io.emit('gameEvent', {
      type: 'game_start',
      tier: lobby.tier
    });

    console.log(`Game ${game.id} started with ${lobby.players.size} players`);

    // Set up winner payout callback
    if (this.onWinnerDetermined) {
      game.onWinnerDetermined = this.onWinnerDetermined;
    }

    // Set up cheat detection callback (passed from index.ts)
    if (this['onCheatDetected']) {
      game.onCheatDetected = this['onCheatDetected'];
    }

    // Set up game end cleanup - remove game and reset lobby when done
    game.onGameEnd = () => {
      console.log(`🎮 Game ${game.id} ended callback - removing from games map`);
      
      // Complete game session record (for auditing)
      // Note: winnerId/winnerName are set in gameRoom before calling onGameEnd
      const winnerId = game.lastWinnerId || 'unknown';
      const winnerName = game.lastWinnerName || 'Unknown';
      const winnerWallet = game.lastWinnerWallet;
      
      this.completeGameSession(game.sessionId || game.id, winnerId, winnerName, winnerWallet);
      
      // Track Dream game end time for cooldown and persist to DB
      if (lobby.tier === 'dream') {
        this.dreamLastGameEnd = Date.now();
        this.saveDreamTimer(); // Persist to database
        const nextAvailable = new Date(this.dreamLastGameEnd + (config.dream.intervalHours * 60 * 60 * 1000));
        console.log(`☁️ Dream game ended at ${new Date(this.dreamLastGameEnd).toISOString()}`);
        console.log(`   Next game available at: ${nextAvailable.toISOString()} (in ${config.dream.intervalHours} hour(s))`);
      }
      
      this.games.delete(game.id);
      this.resetLobby(lobby);
      this.broadcastSingleLobbyUpdate(lobby);
    };

  }

  /**
   * Reset lobby to waiting state
   */
  private resetLobby(lobby: Lobby): void {
    console.log(`Resetting lobby ${lobby.id} - clearing ${lobby.players.size} players, ${lobby.spectators.size} spectators`);
    
    // Call callback to clear IP tracking for these players
    const playerIds = Array.from(lobby.players.keys());
    if (playerIds.length > 0 && this.onLobbyReset) {
      this.onLobbyReset(playerIds);
    }
    
    // DON'T clear payments here - they're needed for pot distribution
    // Payment clearing happens AFTER distribution completes
    
    // Clear all lobby state
    lobby.players.clear();
    lobby.spectators.clear();
    lobby.status = 'waiting';
    lobby.countdownStartTime = null;
    lobby.gameStartTime = null;
    lobby.potSize = 0; // Reset pot
    
    // SAFEGUARD: Ensure no game exists for this lobby
    if (this.games.has(lobby.id)) {
      console.log(`⚠️ Found orphaned game ${lobby.id} during reset - removing it`);
      const game = this.games.get(lobby.id);
      if (game) {
        game.stop();
      }
      this.games.delete(lobby.id);
    }
    
    console.log(`Lobby ${lobby.id} now in WAITING state, ready for new players`);
  }

  /**
   * Join as spectator
   */
  joinAsSpectator(socketId: string, tier: string): { success: boolean; message?: string; gameId?: string } {
    const lobbyId = `lobby_${tier}`;
    const lobby = this.lobbies.get(lobbyId);

    console.log(`Spectator attempting to join lobby: ${lobbyId}, Status: ${lobby?.status}`);

    if (!lobby) {
      console.error(`Spectator error: Lobby not found for tier ${tier}`);
      return { success: false, message: 'Invalid game mode' };
    }

    if (lobby.status !== 'playing') {
      console.error(`Spectator error: Lobby status is ${lobby.status}, not 'playing'`);
      return { success: false, message: `Game is ${lobby.status}, not in progress. Please wait for game to start.` };
    }

    const game = this.games.get(lobby.id);
    if (!game) {
      console.error(`Spectator error: Game not found in games map for ${lobby.id}`);
      return { success: false, message: 'Game not found in active games' };
    }

    // Add to spectators
    game.gameState.spectators.add(socketId);
    
    console.log(`✅ Spectator ${socketId} joined ${tier} game (${game.gameState.spectators.size} spectators)`);

    return { success: true, gameId: game.id };
  }

  /**
   * Get game by ID
   */
  getGame(gameId: string): GameRoom | undefined {
    return this.games.get(gameId);
  }

  getGameForPlayer(playerId: string): GameRoom | undefined {
    for (const game of this.games.values()) {
      if (game.players.has(playerId)) {
        return game;
      }
    }
    return undefined;
  }

  /**
   * Remove ended game and clean up
   */
  removeGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (game) {
      game.stop();
      this.games.delete(gameId);
      console.log(`Game ${gameId} removed from games map`);
    }
  }

  /**
   * Shutdown all active games and lobbies
   */
  shutdown(): void {
    console.log('Shutting down LobbyManager...');
    
    // Stop all active games
    for (const [gameId, game] of this.games.entries()) {
      console.log(`Stopping game ${gameId}...`);
      game.stop();
      this.io.to(gameId).emit('serverShutdown', { message: 'Server is shutting down' });
    }
    this.games.clear();

    // Reset all lobbies
    for (const lobby of this.lobbies.values()) {
      console.log(`Resetting lobby ${lobby.id}...`);
      this.io.to(lobby.id).emit('lobbyCancelled', { message: 'Server is shutting down' });
      this.resetLobby(lobby);
    }

    // Clear bot manager
    this.botManager.clearAll();

    console.log('LobbyManager shutdown complete');
  }

  /**
   * Remove player from lobby
   */
  leaveLobby(playerId: string): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.players.has(playerId)) {
        lobby.players.delete(playerId);
        console.log(`Player ${playerId} left lobby ${lobby.id}`);

        // If in countdown and drops below minimum, cancel
        const minPlayers = lobby.tier === 'dream' ? config.dream.minPlayers : config.lobby.minPlayers;
        if (lobby.status === 'countdown' && lobby.players.size < minPlayers) {
          lobby.status = 'waiting';
          lobby.countdownStartTime = null;
          console.log(`Lobby ${lobby.id} countdown cancelled - below minimum`);
        }
        break;
      }
    }
  }

  /**
   * Broadcast single lobby update immediately
   */
  private broadcastSingleLobbyUpdate(lobby: Lobby): void {
    const countdown = lobby.countdownStartTime
      ? Math.max(0, Math.floor((config.lobby.autoStartCountdown - (Date.now() - lobby.countdownStartTime)) / 1000))
      : null;

    // Get game if playing
    const game = lobby.status === 'playing' ? this.games.get(lobby.id) : null;
    const spectatorCount = game ? game.gameState.spectators.size : lobby.spectators.size;
    
    // Calculate time remaining for active games
    let timeRemaining: number | null = null;
    if (game && lobby.status === 'playing') {
      const elapsed = Date.now() - game.gameStartTime;
      timeRemaining = Math.max(0, game.maxDuration - elapsed);
    }
    
    let realPlayerCount = 0;
    let botCount = 0;
    
    if (game && lobby.status === 'playing') {
      // Count alive players and bots in active game
      for (const player of game.players.values()) {
        if (player.snake && player.snake.segments.length > 0) {
          if (player.isBot) {
            botCount++;
          } else {
            realPlayerCount++;
          }
        }
      }
    } else {
      // Count players in lobby
      for (const player of lobby.players.values()) {
        if (player.isBot) {
          botCount++;
        } else {
          realPlayerCount++;
        }
      }
    }

    // Add Dream cooldown info if applicable
    let dreamCooldown = null;
    if (lobby.tier === 'dream') {
      dreamCooldown = this.getDreamCooldownRemaining();
    }

    const update = {
      tier: lobby.tier,
      playersLocked: realPlayerCount + botCount,
      realPlayerCount,
      botCount,
      maxPlayers: lobby.maxPlayers,
      minPlayers: lobby.tier === 'dream' ? config.dream.minPlayers : config.lobby.minPlayers,
      status: lobby.status,
      countdown,
      spectatorCount,
      timeRemaining,
      dreamCooldown, // milliseconds until next Dream game
      potSize: lobby.potSize || 0, // Current pot in USDC
    };

    this.io.emit('lobbyUpdate', update); // Global for homepage
    this.io.to(lobby.id).emit('lobbyUpdate', update); // To lobby room
  }

  /**
   * Broadcast lobby updates
   */
  broadcastLobbyUpdates(): void {
    setInterval(() => {
      for (const lobby of this.lobbies.values()) {
        // For Dream mode: only broadcast after initialization (DB data loaded)
        if (lobby.tier === 'dream') {
          if (this.isInitialized) {
            this.broadcastSingleLobbyUpdate(lobby);
          }
          // Skip Dream lobby if not initialized yet
        } else if (lobby.players.size > 0 || lobby.status !== 'waiting') {
          // Broadcast other lobbies if they have players
          this.broadcastSingleLobbyUpdate(lobby);
        }
      }
    }, 1000);
  }

  /**
   * Get count of active games
   */
  getActiveGamesCount(): number {
    return this.games.size;
  }

  /**
   * Get count of players currently in active games (alive and playing)
   */
  getPlayersInGameCount(): number {
    let count = 0;
    for (const game of this.games.values()) {
      // Count alive real players only (not bots, and not yet spectating)
      for (const player of game.players.values()) {
        if (player.snake && player.snake.segments.length > 0 && !player.isBot) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Get total spectator count across all games
   */
  getTotalSpectators(): number {
    let count = 0;
    for (const game of this.games.values()) {
      count += game.gameState.spectators.size;
    }
    return count;
  }

  /**
   * Get highest ranking human player (for bot win scenarios)
   */
  getHighestRankingHuman(gameId: string): { playerId: string; playerName: string } | null {
    const game = this.games.get(gameId);
    if (!game) {
      return null;
    }

    // Find all human players sorted by total length
    const humanPlayers = Array.from(game.players.values())
      .filter(p => !p.isBot)
      .sort((a, b) => {
        const lengthA = a.snake ? a.snake.length : 0;
        const lengthB = b.snake ? b.snake.length : 0;
        return lengthB - lengthA; // Descending order
      });

    if (humanPlayers.length === 0) {
      return null;
    }

    const topPlayer = humanPlayers[0];
    return {
      playerId: topPlayer.id,
      playerName: topPlayer.name,
    };
  }

  /**
   * Clean up disconnected spectators from all games
   */
  cleanupDisconnectedSpectators(io: Server): number {
    let removedCount = 0;
    
    for (const game of this.games.values()) {
      const toRemove: string[] = [];
      
      for (const socketId of game.gameState.spectators) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket || !socket.connected) {
          toRemove.push(socketId);
        }
      }
      
      for (const socketId of toRemove) {
        game.gameState.spectators.delete(socketId);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} disconnected spectators`);
    }
    
    return removedCount;
  }
}

