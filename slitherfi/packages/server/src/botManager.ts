import { GameRoom } from './gameRoom.js';

export class BotManager {
  private bots: Map<string, { 
    gameRoom: GameRoom; 
    intervalId: NodeJS.Timeout;
    currentTarget?: { x: number; y: number; pelletId?: string };
    targetLockTime?: number;
    lastPosition?: { x: number; y: number };
    stuckCounter: number;
  }>;

  constructor() {
    this.bots = new Map();
  }

  addBot(botId: string, gameRoom: GameRoom): void {
    const intervalId = setInterval(() => {
      this.updateBot(botId, gameRoom);
    }, 100);

    this.bots.set(botId, { 
      gameRoom, 
      intervalId,
      stuckCounter: 0
    });
  }

  private updateBot(botId: string, gameRoom: GameRoom): void {
    const player = gameRoom.players.get(botId);
    const botData = this.bots.get(botId);
    if (!player || player.snake.segments.length === 0 || !botData) {
      this.removeBot(botId);
      return;
    }

    const now = Date.now();
    const snakeHead = player.snake.segments[0];
    const botName = player.name;

    // Track bot movement to detect if stuck
    if (botData.lastPosition) {
      const movedDist = Math.sqrt(
        (snakeHead.x - botData.lastPosition.x) ** 2 + 
        (snakeHead.y - botData.lastPosition.y) ** 2
      );
      
      // If barely moving, increment stuck counter
      if (movedDist < 10) {
        botData.stuckCounter++;
      } else {
        botData.stuckCounter = 0;
      }
    }
    botData.lastPosition = { x: snakeHead.x, y: snakeHead.y };

    // Get safe bounds
    const bounds = gameRoom.currentMapBounds;
    const SAFE_MARGIN = 200;

    // Find nearest pellet that's WITHIN safe bounds
    let nearestPellet: { x: number; y: number; id: string } | null = null;
    let minPelletDist = Infinity;

    // Check if current locked target still exists
    let currentTargetExists = false;
    if (botData.currentTarget && botData.targetLockTime && (now - botData.targetLockTime < 2000)) {
      for (const pellet of gameRoom.pellets.values()) {
        if (botData.currentTarget.pelletId === pellet.id) {
          currentTargetExists = true;
          const dist = Math.sqrt(
            (pellet.x - snakeHead.x) ** 2 + (pellet.y - snakeHead.y) ** 2
          );
          nearestPellet = { x: pellet.x, y: pellet.y, id: pellet.id };
          minPelletDist = dist;
          break;
        }
      }
    }

    // If no locked target or it's gone, find new target
    if (!currentTargetExists) {
      for (const [pelletId, pellet] of gameRoom.pellets.entries()) {
        // Skip pellets outside safe zone
        if (pellet.x < bounds.minX + SAFE_MARGIN || pellet.x > bounds.maxX - SAFE_MARGIN ||
            pellet.y < bounds.minY + SAFE_MARGIN || pellet.y > bounds.maxY - SAFE_MARGIN) {
          continue;
        }

        const dist = Math.sqrt(
          (pellet.x - snakeHead.x) ** 2 + (pellet.y - snakeHead.y) ** 2
        );
        if (dist < 500 && dist < minPelletDist) {
          minPelletDist = dist;
          nearestPellet = { x: pellet.x, y: pellet.y, id: pelletId };
        }
      }
      
      // Lock onto new target
      if (nearestPellet) {
        botData.currentTarget = { x: nearestPellet.x, y: nearestPellet.y, pelletId: nearestPellet.id };
        botData.targetLockTime = now;
      }
    }

    // Find nearby snakes to avoid
    let nearestSnakeHead: { x: number; y: number; dist: number } | null = null;
    let nearbyBots: Array<{ x: number; y: number }> = [];

    for (const p of gameRoom.players.values()) {
      if (p.id === botId) continue;
      if (p.snake.segments.length === 0) continue;
      
      const otherHead = p.snake.segments[0];
      const dist = Math.sqrt(
        (otherHead.x - snakeHead.x) ** 2 + (otherHead.y - snakeHead.y) ** 2
      );

      // Detect nearby bots (prevent clustering)
      if (p.isBot && dist < 200) {
        nearbyBots.push({ x: otherHead.x, y: otherHead.y });
      }

      // Track nearest snake for avoidance
      if (!nearestSnakeHead || dist < nearestSnakeHead.dist) {
        nearestSnakeHead = { x: otherHead.x, y: otherHead.y, dist };
      }
    }

    // Decision making
    let targetX: number;
    let targetY: number;

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    // Priority 1: Chase pellets (primary behavior)
    if (nearestPellet) {
      // Smart targeting: Use predictive aiming to avoid circling
      const currentAngle = player.snake.angle;
      const angleToTarget = Math.atan2(
        nearestPellet.y - snakeHead.y,
        nearestPellet.x - snakeHead.x
      );
      
      // Calculate angle difference
      let angleDiff = angleToTarget - currentAngle;
      // Normalize to -PI to PI
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      
      // If pellet is very close and we're circling (large angle diff), target ahead
      if (minPelletDist < 100 && Math.abs(angleDiff) > Math.PI / 3) {
        // Target a point ahead of the pellet in the direction we're moving
        const leadDistance = 150;
        targetX = nearestPellet.x + Math.cos(currentAngle) * leadDistance;
        targetY = nearestPellet.y + Math.sin(currentAngle) * leadDistance;
      } else if (minPelletDist < 50) {
        // Very close - use wider lead to ensure we don't circle
        const leadDistance = 100;
        targetX = nearestPellet.x + Math.cos(angleToTarget) * leadDistance;
        targetY = nearestPellet.y + Math.sin(angleToTarget) * leadDistance;
      } else {
        // Normal targeting at medium/far range
        targetX = nearestPellet.x;
        targetY = nearestPellet.y;
      }
      
      // Avoidance: If too close to another snake, add avoidance vector
      if (nearestSnakeHead && nearestSnakeHead.dist < 100) {
        const avoidX = snakeHead.x - nearestSnakeHead.x;
        const avoidY = snakeHead.y - nearestSnakeHead.y;
        targetX += avoidX * 2;
        targetY += avoidY * 2;
      }
    }
    // Priority 2: Wander
    else {
      // Add avoidance randomness if near bots
      let randomOffset = 400;
      if (nearbyBots.length > 0) {
        // Add extra randomness to break symmetry
        randomOffset = 600;
      }
      
      targetX = centerX + (Math.random() - 0.5) * randomOffset;
      targetY = centerY + (Math.random() - 0.5) * randomOffset;
    }

    // Calculate distance to target
    const distToTarget = Math.sqrt(
      (targetX - snakeHead.x) ** 2 + (targetY - snakeHead.y) ** 2
    );

    // STUCK RECOVERY: If bot is circling/stuck for too long
    if (botData.stuckCounter > 5 || distToTarget < 5) {
      console.log(`⚠️ ${botName} STUCK (counter: ${botData.stuckCounter})! Forcing new wander target`);
      
      // Clear current target
      botData.currentTarget = undefined;
      botData.targetLockTime = undefined;
      botData.stuckCounter = 0;
      
      // Pick a random direction far away
      const randomAngle = Math.random() * Math.PI * 2;
      const randomDist = 300 + Math.random() * 300;
      targetX = snakeHead.x + Math.cos(randomAngle) * randomDist;
      targetY = snakeHead.y + Math.sin(randomAngle) * randomDist;
      
      // Clamp to safe bounds
      targetX = Math.max(bounds.minX + SAFE_MARGIN, Math.min(bounds.maxX - SAFE_MARGIN, targetX));
      targetY = Math.max(bounds.minY + SAFE_MARGIN, Math.min(bounds.maxY - SAFE_MARGIN, targetY));
    }

    gameRoom.handlePlayerMove(botId, targetX, targetY);

    // Boost occasionally when chasing pellets (but not when stuck/circling)
    if (nearestPellet && minPelletDist < 200 && minPelletDist > 50 && 
        player.snake.length > 40 && botData.stuckCounter < 3 && Math.random() < 0.1) {
      gameRoom.handlePlayerBoost(botId, true);
      // Stop boosting after short burst
      setTimeout(() => gameRoom.handlePlayerBoost(botId, false), 500);
    }
  }

  removeBot(botId: string): void {
    const bot = this.bots.get(botId);
    if (bot) {
      clearInterval(bot.intervalId);
      this.bots.delete(botId);
    }
  }

  removeAllBots(): void {
    for (const [botId] of this.bots) {
      this.removeBot(botId);
    }
  }

  clearAll(): void {
    console.log(`Clearing ${this.bots.size} bots...`);
    this.removeAllBots();
  }
}

