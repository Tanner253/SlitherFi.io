export interface Vector2 {
  x: number;
  y: number;
}

export interface PlayerStats {
  pelletsEaten: number;
  cellsEaten: number; // Snakes killed (was maxMass in Agar)
  maxLength: number; // Maximum segments achieved (replaces maxMass)
  leaderTime: number;
  bestRank: number;
  timeSurvived: number;
}

export interface SnakeSegment {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  playerId: string;
  segments: SnakeSegment[]; // Array of {x, y} positions, [0] = head
  angle: number; // Head rotation angle in radians
  length: number; // Total segments
  velocity: Vector2;
  color: string;
  isBoosting: boolean;
  lastBoostCostTime: number; // Track when to deduct segment for boosting
  headPath: SnakeSegment[]; // History of head positions for body following
  targetX: number; // Target position from player input
  targetY: number;
  spawnTime: number; // When snake was spawned (for self-collision delay)
  statMultiplier?: number; // Tier-based stat boost (mass & speed)
}

export interface Player {
  id: string;
  socketId: string;
  name: string;
  snake: Snake; // Single snake instead of multiple blobs
  totalLength: number; // Total segments (replaces totalMass)
  stats: PlayerStats;
  joinTime: number;
  lastInputTime: number;
  isBot: boolean;
  boundaryTouchTime?: number; // When player started touching boundary
  walletAddress?: string; // Linked wallet address
}

export interface Pellet {
  id: string;
  x: number;
  y: number;
  mass: number;
  color?: string; // Random color for pellets
  velocity?: Vector2; // For ejected pellets that move (like splitVelocity)
  createdAt?: number; // When pellet was created
  splitVelocity?: Vector2; // Launch velocity for ejected pellets
}

export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  startingMass: number;
  pelletCount: number;
  tickRate: number;
  maxGameDuration: number;
  spatialHashGridSize: number;
}

export interface LobbyConfig {
  minPlayers: number;
  maxPlayers: number;
  maxWaitTime: number;
  autoStartCountdown: number;
}

export interface Lobby {
  id: string;
  tier: string;
  players: Map<string, Player>;
  spectators: Set<string>; // Socket IDs of spectators
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  countdownStartTime: number | null;
  gameStartTime: number | null;
  maxPlayers: number;
  potSize: number; // Total USDC collected for this lobby
}

export interface GameState {
  players: Map<string, Player>;
  pellets: Map<string, Pellet>;
  spectators: Set<string>; // Socket IDs of spectators
  startTime: number;
  lastTickTime: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  length: number; // Changed from mass to length
  cellsEaten: number;
  rank: number;
}

export interface GameEndResult {
  winnerId: string | null;
  finalRankings: Array<{
    id: string;
    name: string;
    length: number; // Changed from mass to length
    timeSurvived: number;
    cellsEaten: number;
  }>;
  playerStats: Record<string, PlayerStats>;
}

