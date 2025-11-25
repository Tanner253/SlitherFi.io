import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root slitherfi directory
dotenv.config({ path: path.join(__dirname, '../../../.env') });

export const config = {
  server: {
    port: parseInt(process.env.SERVER_PORT || '3001'),
    tickRate: parseInt(process.env.SERVER_TICK_RATE || '60'),
  },
  game: {
    mapWidth: parseInt(process.env.MAP_WIDTH || '5000'),
    mapHeight: parseInt(process.env.MAP_HEIGHT || '5000'),
    startingMass: parseInt(process.env.STARTING_MASS || '250'),
    pelletCount: parseInt(process.env.PELLET_COUNT || '1000'), // Doubled for Christmas snow effect
    maxGameDuration: parseInt(process.env.MAX_GAME_DURATION_MS || '1800000'),
    spatialHashGridSize: parseInt(process.env.SPATIAL_HASH_GRID_SIZE || '200'),
    shrinkingEnabled: process.env.SHRINKING_ENABLED !== 'false', // Default true
    shrinkStartPercent: parseFloat(process.env.SHRINK_START_PERCENT || '0.5'), // Start at 50% time
  },
  lobby: {
    // In production: ALWAYS use LOBBY_MIN_PLAYERS (ignore MIN_PLAYERS_DEV)
    // In development: Use MIN_PLAYERS_DEV if set, else LOBBY_MIN_PLAYERS
    minPlayers: process.env.NODE_ENV === 'production'
      ? parseInt(process.env.LOBBY_MIN_PLAYERS || '10')
      : parseInt(process.env.MIN_PLAYERS_DEV || process.env.LOBBY_MIN_PLAYERS || '10'),
    maxPlayersStandard: parseInt(process.env.LOBBY_MAX_PLAYERS_STANDARD || '25'),
    maxPlayersWhale: parseInt(process.env.LOBBY_MAX_PLAYERS_WHALE || '50'),
    maxWaitTime: parseInt(process.env.LOBBY_MAX_WAIT_MS || '600000'),
    autoStartCountdown: parseInt(process.env.LOBBY_AUTO_START_COUNTDOWN_MS || '120000'),
  },
  dev: {
    // Auto-fill bots ONLY in development (never in production)
    autoFillBots: process.env.NODE_ENV !== 'production' && process.env.AUTO_FILL_BOTS === 'true',
  },
  dream: {
    enabled: process.env.DREAM_ENABLED === 'true',
    payoutUSDC: parseFloat(process.env.DREAM_PAYOUT_USDC || '1'),
    // Dream uses same min players as lobbies (respects NODE_ENV)
    minPlayers: process.env.NODE_ENV === 'production'
      ? parseInt(process.env.DREAM_MIN_PLAYERS || process.env.LOBBY_MIN_PLAYERS || '10')
      : parseInt(process.env.MIN_PLAYERS_DEV || process.env.DREAM_MIN_PLAYERS || '10'),
    maxPlayers: parseInt(process.env.DREAM_MAX_PLAYERS || '25'),
    gameDuration: parseInt(process.env.DREAM_GAME_DURATION_MS || '1800000'),
    intervalHours: parseInt(process.env.DREAM_INTERVAL_HOURS || '1'),
  },
  payment: {
    winnerPercentage: parseFloat(process.env.WINNER_PERCENTAGE || '80'),
    platformPercentage: parseFloat(process.env.PLATFORM_PERCENTAGE || '15'),
    burnPercentage: parseFloat(process.env.BURN_PERCENTAGE || '5'),
    burnWalletAddress: process.env.BURN_WALLET_ADDRESS || 'H1KqwEHWJNBxnbuiVQi4iTEaR7p1nVXi3aPv34zzBrPE',
  },
  gameModes: [] as Array<{ tier: string; buyIn: number; name: string; maxPlayers: number; locked?: boolean; requiresPayment: boolean; statMultiplier?: number }>,
};

// Build gameModes array AFTER config is created (so we can reference dream settings)
const dreamMaxPlayers = parseInt(process.env.DREAM_MAX_PLAYERS || '25');

config.gameModes = [
  { tier: 'dream', buyIn: 0, name: 'Dream Mode', maxPlayers: dreamMaxPlayers, requiresPayment: false, statMultiplier: 1 },
  { tier: '1', buyIn: parseFloat(process.env.GAME_MODE_1_ENTRY || '0.10'), name: 'Micro Sneks', maxPlayers: 25, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_1_STAT_MULTIPLIER || '1.1') },
  { tier: '5', buyIn: parseFloat(process.env.GAME_MODE_5_ENTRY || '0.15'), name: 'Low Sneks', maxPlayers: 25, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_5_STAT_MULTIPLIER || '1.15') },
  { tier: '10', buyIn: parseFloat(process.env.GAME_MODE_10_ENTRY || '0.25'), name: 'Medium Sneks', maxPlayers: 25, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_10_STAT_MULTIPLIER || '1.3') },
  { tier: '25', buyIn: parseFloat(process.env.GAME_MODE_25_ENTRY || '0.50'), name: 'High Sneks', maxPlayers: 25, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_25_STAT_MULTIPLIER || '1.5') },
  { tier: '50', buyIn: parseFloat(process.env.GAME_MODE_50_ENTRY || '1.00'), name: 'Very High Sneks', maxPlayers: 25, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_50_STAT_MULTIPLIER || '2') },
  { tier: '100', buyIn: parseFloat(process.env.GAME_MODE_100_ENTRY || '5.00'), name: 'Elite Sneks', maxPlayers: 25, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_100_STAT_MULTIPLIER || '3') },
  { tier: 'whale', buyIn: parseFloat(process.env.GAME_MODE_WHALE_ENTRY || '500'), name: 'Whale Mode', maxPlayers: 50, locked: true, requiresPayment: true, statMultiplier: parseFloat(process.env.GAME_MODE_WHALE_STAT_MULTIPLIER || '5') },
];

