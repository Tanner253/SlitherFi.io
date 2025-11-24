import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from './config.js';
import { LobbyManager } from './lobbyManager.js';
import { WalletManager } from './wallet/walletManager.js';
import { PaymentService } from './wallet/paymentService.js';
import { EntryFeeService } from './wallet/entryFeeService.js';
import { DistributionService } from './wallet/distributionService.js';
import { refundIncompletPayments } from './wallet/refundIncomplete.js';
import { getAllTransactions, getRecentTransactions } from './wallet/transactionLogger.js';
import { loadBannedIPs, saveBan, getAllBans } from './banManager.js';
import { connectDB } from './lib/db.js';
import { Transaction } from './models/Transaction.js';
import { GameSession } from './models/GameSession.js';
import { User } from './models/User.js';
import { BannedIP } from './models/BannedIP.js';
import { ChatMessage } from './models/ChatMessage.js';
import { DreamTimer } from './models/DreamTimer.js';
import { createPaymentRequired, extractPaymentHeader, decodePaymentPayload, validatePaymentPayload } from './lib/x402.js';
import type { LobbyAccessToken } from './types/x402.js';
import { createAuthRequired, verifySignature, decodeAuthHeader, isRateLimited, recordAuthFailure, clearRateLimit, createSessionToken, verifySessionToken } from './lib/x403.js';
import type { SignedChallenge } from './types/x403.js';
import { AuthSession } from './models/AuthSession.js';
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors());
app.use(express.json());

// JWT Secret for session tokens (x403/x402)
const JWT_SECRET = process.env.JWT_SECRET || 'slitherfi-dev-secret-change-in-production';

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Map to track player wallet addresses
const playerWallets = new Map<string, string>();

// Map to track which lobby each player is in (for cleanup on disconnect)
const playerToLobby = new Map<string, string>(); // playerId -> lobbyId

// Anti-farming: Track active connections by IP address
const activeConnectionsByIP = new Map<string, string>(); // IP -> socketId (only 1 connection per IP)

// Anti-farming: Track active players by IP address (legacy - kept for tracking)
const activePlayersByIP = new Map<string, Set<string>>(); // IP -> Set of playerIds

// Track refunded players to prevent double refunds (player leaves then disconnects)
const refundedPlayers = new Set<string>(); // playerIds that have already been refunded
const refundsInProgress = new Map<string, Promise<any>>(); // Track ongoing refund operations

// Anti-cheat: Banned IPs (loaded from file for persistence)
const bannedIPs = loadBannedIPs();

// Whitelist dev IPs (set via environment variable)
// Localhost is always whitelisted for testing
const DEV_IP_WHITELIST = [
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  ...(process.env.DEV_IP_WHITELIST?.split(',').map(ip => ip.trim()).filter(ip => ip) || [])
];

const lobbyManager = new LobbyManager(io);

// Track if DB is ready (used later for refund check)
let dbReady = false;

// Initialize MongoDB connection and load Dream timer
connectDB()
  .then(async (mongoose) => {
    console.log('🗄️ Database ready');
    
    // Ensure connection is fully established
    if (mongoose.connection.readyState === 1) {
      dbReady = true;

      // Clear all x403 authentication sessions on server restart (fresh state)
      try {
        const deletedSessions = await (AuthSession as any).deleteMany({});
        console.log(`🧹 x403: Cleared ${deletedSessions.deletedCount || 0} authentication sessions (server restart)`);
        console.log('   All users must re-authenticate with wallet signature on next join');
      } catch (error) {
        console.warn('⚠️ x403: Could not clear sessions on startup:', error);
      }

      // Initialize LobbyManager (loads Dream timer from DB)
      await lobbyManager.initialize();
    } else {
      console.warn('⚠️ Database connection not ready - skipping Dream timer load');
    }
  })
  .catch(error => {
    console.error('⚠️ Database connection failed (will continue without DB):', error.message);
  });

// Initialize payment services (if configured)
let paymentService: PaymentService | null = null;
let entryFeeService: EntryFeeService | null = null;
let distributionService: DistributionService | null = null;
let walletManager: WalletManager | null = null;

if (process.env.PLATFORM_WALLET_PRIVATE_KEY && process.env.SOLANA_RPC_URL) {
  try {
    walletManager = new WalletManager(
      process.env.SOLANA_RPC_URL,
      process.env.PLATFORM_WALLET_PRIVATE_KEY,
      process.env.USDC_MINT_ADDRESS || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    );
    paymentService = new PaymentService(walletManager);
    entryFeeService = new EntryFeeService(walletManager);
    distributionService = new DistributionService(walletManager);
    
    console.log('💰 Payment services initialized');
    console.log(`   Platform wallet: ${walletManager.getPlatformAddress()}`);
    console.log(`   Dream Mode payout: ${config.dream.payoutUSDC} USDC (from DREAM_PAYOUT_USDC)`);
    console.log(`   Entry fee collection: ✅ Enabled`);
    console.log(`   Pot distribution: 80/15/5 split`);
    
    // Set entry fee service reference on lobby manager
    lobbyManager.setEntryFeeService(entryFeeService);
    
    // Check for incomplete payments and refund (if DB is ready)
    if (dbReady) {
      // Small delay to ensure DB operations are ready
      setTimeout(async () => {
        await refundIncompletPayments(walletManager!);
      }, 2000);
    }
    
    // Set winner payout callback on lobby manager
    lobbyManager.setWinnerPayoutCallback(async (winnerId, winnerName, gameId, sessionId, tier, playersCount) => {
      // Check if this is Dream Mode (free tier)
      const isDreamMode = tier === 'dream';
      
      if (isDreamMode) {
        // Dream Mode: Free hourly game (only for humans)
        const isBot = winnerName.startsWith('Bot ');
        
        if (isBot) {
          console.log('\n╔════════════════════════════════════════════════════════════╗');
          console.log('║           🤖 DREAM MODE - BOT WIN                          ║');
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log(`║ Session ID:    ${sessionId.padEnd(44)} ║`);
          console.log(`║ Winner:        ${winnerName.padEnd(44)} ║`);
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log('║ 🚫 PAYOUT:      $0.00 (Bots not eligible)                  ║');
          console.log('║ Type:          DREAM MODE (Human players only)             ║');
          console.log('╚════════════════════════════════════════════════════════════╝\n');
          return;
        }
        
        const walletAddress = playerWallets.get(winnerId);
        
        if (!walletAddress) {
          console.error(`❌ No wallet address found for winner ${winnerName} (${winnerId})`);
          return;
        }
        
        const result = await paymentService!.sendWinnerPayout(
          winnerId,
          winnerName,
          walletAddress,
          sessionId,
          tier,
          playersCount,
          config.dream.payoutUSDC
        );
        
        if (result.success) {
          console.log('\n╔════════════════════════════════════════════════════════════╗');
          console.log('║           💰 DREAM MODE PAYOUT SUMMARY                     ║');
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log(`║ Session ID:    ${sessionId.padEnd(44)} ║`);
          console.log(`║ Winner:        ${winnerName.padEnd(44)} ║`);
          console.log(`║ Wallet:        ${walletAddress.substring(0, 44).padEnd(44)} ║`);
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log(`║ 🎁 REWARD:      $${config.dream.payoutUSDC.toFixed(2).padStart(42)} ║`);
          console.log(`║ TX:            ${result.txSignature!.substring(0, 44).padEnd(44)} ║`);
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log('║ Type:          DREAM MODE (Platform Funded - 100%)         ║');
          console.log('║ Split:         None (Dream Mode gives full reward)         ║');
          console.log('╚════════════════════════════════════════════════════════════╝\n');
          
          // Send payout info to winner's socket
          const winnerSocket = Array.from(io.sockets.sockets.values()).find(s => {
            const pid = Array.from(playerWallets.entries()).find(([id, wallet]) => wallet === walletAddress)?.[0];
            return pid && s.id === pid;
          });
          
          if (winnerSocket) {
            winnerSocket.emit('payoutReceived', {
              gameId: sessionId,
              amount: config.dream.payoutUSDC,
              txSignature: result.txSignature
            });
            console.log(`📤 Dream payout info sent to winner: $${config.dream.payoutUSDC}`);
          } else {
            io.to(gameId).emit('payoutReceived', {
              gameId: sessionId,
              amount: config.dream.payoutUSDC,
              txSignature: result.txSignature
            });
            console.log(`📤 Dream payout info broadcasted: $${config.dream.payoutUSDC}`);
          }
        } else {
          console.error(`\n❌ Failed to pay Dream Mode winner ${winnerName}: ${result.error}\n`);
        }
      } else {
        // Paid tier: Use distribution service (80/15/5)
        console.log(`💰 Processing pot distribution for ${tier} game: ${sessionId}`);
        
        // Check if winner is a bot
        const isBot = winnerName.startsWith('Bot ');
        let actualWinnerWallet = playerWallets.get(winnerId);
        let actualWinnerName = winnerName;
        
        // Get actual pot from paid entry fees (needed for all checks)
        const totalPot = await entryFeeService!.getLobbyPot(gameId);
        const paidPlayers = await entryFeeService!.getPaidPlayerCount(gameId);
        
        // If bot won, find highest ranking human player
        if (isBot) {
          console.log(`🤖 Bot won - finding highest ranking human player...`);
          const humanWinner = lobbyManager.getHighestRankingHuman(gameId);
          
          if (humanWinner) {
            actualWinnerWallet = playerWallets.get(humanWinner.playerId);
            actualWinnerName = humanWinner.playerName;
            console.log(`   Highest human: ${actualWinnerName}`);
          } else {
            console.log('\n╔════════════════════════════════════════════════════════════╗');
            console.log('║           🤖 ALL BOTS GAME - NO PAYOUT                     ║');
            console.log('╠════════════════════════════════════════════════════════════╣');
            console.log(`║ Session ID:    ${sessionId.padEnd(44)} ║`);
            console.log(`║ Tier:          $${tier.padEnd(43)} ║`);
            console.log('╠════════════════════════════════════════════════════════════╣');
            console.log(`║ 💵 POT:         $${totalPot.toFixed(2).padStart(42)} ║`);
            console.log('╠════════════════════════════════════════════════════════════╣');
            console.log('║ 🏦 DISPOSITION: Returned to treasury (no human winners)    ║');
            console.log('║ 💰 Platform:    +$' + totalPot.toFixed(2).padStart(40) + ' ║');
            console.log('╚════════════════════════════════════════════════════════════╝\n');
            
            // CRITICAL: Clear payment records to prevent pot accumulation
            const lobbyId = sessionId.split('_').slice(0, 2).join('_');
            if (entryFeeService) {
              await entryFeeService.clearLobbyPayments(lobbyId);
              console.log(`🧹 Payment records cleared for ${lobbyId} (bot-only game cleanup)\n`);
            }
            
            return; // Pot stays in treasury
          }
        }
        
        if (!actualWinnerWallet) {
          console.error(`❌ No wallet address found for winner ${actualWinnerName}`);
          return;
        }
        
        if (totalPot === 0 || paidPlayers === 0) {
          console.log('\n╔════════════════════════════════════════════════════════════╗');
          console.log('║           ⚠️  NO POT TO DISTRIBUTE                         ║');
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log(`║ Session ID:    ${sessionId.padEnd(44)} ║`);
          console.log(`║ Tier:          $${tier.padEnd(43)} ║`);
          console.log(`║ Winner:        ${actualWinnerName.padEnd(44)} ║`);
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log(`║ 💰 POT:         $${totalPot.toFixed(2).padStart(42)} ║`);
          console.log(`║ 👥 Paid Players: ${paidPlayers.toString().padStart(42)} ║`);
          console.log('╠════════════════════════════════════════════════════════════╣');
          console.log('║ Reason:        No entry fees collected (dev/test mode?)    ║');
          console.log('╚════════════════════════════════════════════════════════════╝\n');
          
          // Clear payment records anyway (cleanup)
          const lobbyId = sessionId.split('_').slice(0, 2).join('_');
          if (entryFeeService) {
            await entryFeeService.clearLobbyPayments(lobbyId);
            console.log(`🧹 Payment records cleared for ${lobbyId} (no-pot game cleanup)\n`);
          }
          
          return;
        }
        
        // Distribute pot: 80% winner, 15% platform, 5% burn
        const result = await distributionService!.distributePot(
          sessionId,
          tier,
          totalPot,
          paidPlayers,
          actualWinnerWallet,
          actualWinnerName,
          isBot,
          entryFeeService // Pass service so it can clear payments immediately
        );
        
        if (result.success) {
          // Distribution service already logs detailed summary box
          console.log(`\n🎉 GAME ${sessionId} PAYOUT COMPLETE`);
          
          // Send payout info to winner's socket
          const winnerSocket = Array.from(io.sockets.sockets.values()).find(s => {
            // Find socket with matching player ID
            const pid = Array.from(playerWallets.entries()).find(([id, wallet]) => wallet === actualWinnerWallet)?.[0];
            return pid && s.id === pid;
          });
          
          if (winnerSocket) {
            winnerSocket.emit('payoutReceived', {
              gameId: sessionId,
              amount: result.winnerAmount,
              txSignature: result.winnerTx
            });
            console.log(`📤 Payout info sent to winner's client: $${result.winnerAmount}`);
          } else {
            // Fallback: broadcast to game room
            io.to(gameId).emit('payoutReceived', {
              gameId: sessionId,
              amount: result.winnerAmount,
              txSignature: result.winnerTx
            });
            console.log(`📤 Payout info broadcasted to game room: $${result.winnerAmount}`);
          }
        } else {
          console.error(`\n❌ ══════════════════════════════════════════════════════════`);
          console.error(`   PAYOUT FAILED FOR GAME: ${sessionId}`);
          console.error(`   Error: ${result.error}`);
          console.error(`   Pot: $${totalPot} (${paidPlayers} paid players)`);
          console.error(`   Winner: ${actualWinnerName}`);
          console.error(`   ══════════════════════════════════════════════════════════\n`);
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize payment service:', error);
    console.error('   Games will run without payouts');
  }
}

// Track total connected clients
let connectedClients = 0;

// Helper function to broadcast stats
const broadcastStats = () => {
  io.emit('statsUpdate', {
    connectedClients,
    playersInGame: lobbyManager.getPlayersInGameCount(),
    totalSpectators: lobbyManager.getTotalSpectators()
  });
};

// REST API Endpoints
app.get('/api/health', (req: any, res: any) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

app.get('/api/lobbies', (req: any, res: any) => {
  res.json(lobbyManager.getLobbiesStatus());
});

app.get('/api/stats', (req: any, res: any) => {
  res.json({
    connectedClients,
    playersInGame: lobbyManager.getPlayersInGameCount(),
    totalSpectators: lobbyManager.getTotalSpectators()
  });
});

app.get('/api/debug/spectators', (req: any, res: any) => {
  const games = lobbyManager['games'];
  const spectatorDebug: any = {};
  
  for (const [gameId, game] of games.entries()) {
    spectatorDebug[gameId] = {
      spectatorCount: game.gameState.spectators.size,
      spectatorIds: Array.from(game.gameState.spectators),
      connectedSockets: Array.from(game.gameState.spectators).map(id => {
        const socket = io.sockets.sockets.get(id);
        return {
          socketId: id,
          connected: socket ? socket.connected : false
        };
      })
    };
  }
  
  res.json({
    totalGames: games.size,
    totalSpectators: lobbyManager.getTotalSpectators(),
    games: spectatorDebug
  });
});

app.get('/api/game-modes', (req: any, res: any) => {
  // Return both game modes and lobby statuses
  const lobbyStatuses = lobbyManager.getLobbiesStatus();
  res.json({
    modes: config.gameModes,
    lobbies: lobbyStatuses
  });
});

// Transaction log endpoint
app.get('/api/transactions', async (req: any, res: any) => {
  try {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const transactions = await getRecentTransactions(limit);
    
    // Get stats from database (not from loaded transactions)
    let stats = {
      totalCount: transactions.length,
      successCount: 0,
      totalPaid: 0,
      uniqueWinners: 0
    };
    
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState === 1) {
        const { Transaction } = await import('./models/Transaction.js');
        
        // Total count
        stats.totalCount = await (Transaction as any).countDocuments();
        
        // Successful count
        stats.successCount = await (Transaction as any).countDocuments({ status: 'success' });
        
        // Total paid (sum of successful transactions)
        const paidResult = await (Transaction as any).aggregate([
          { $match: { status: 'success' } },
          { $group: { _id: null, total: { $sum: '$amountUSDC' } } }
        ]);
        stats.totalPaid = paidResult.length > 0 ? paidResult[0].total : 0;
        
        // Unique winners (distinct wallet addresses)
        const uniqueWallets = await (Transaction as any).distinct('walletAddress');
        stats.uniqueWinners = uniqueWallets.length;
      }
    } catch (error) {
      console.error('Error fetching transaction stats:', error);
    }
    
    res.json({ transactions, stats });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ 
      transactions: [], 
      stats: { totalCount: 0, successCount: 0, totalPaid: 0, uniqueWinners: 0 },
      error: 'Failed to fetch transactions' 
    });
  }
});

// Platform wallet status endpoint
app.get('/api/platform-status', async (req: any, res: any) => {
  if (!paymentService) {
    res.json({
      enabled: false,
      balance: 0,
      canPay: false,
      message: 'Payment service not configured'
    });
    return;
  }

  try {
    const balance = await paymentService.getPlatformBalance();
    const canPay = await paymentService.canPayWinners();
    
    res.json({
      enabled: true,
      balance,
      canPay,
      message: canPay ? 'Creator rewards available' : 'Waiting for more creator rewards to fund games'
    });
  } catch (error) {
    res.status(500).json({
      enabled: true,
      balance: 0,
      canPay: false,
      error: 'Failed to check platform status'
    });
  }
});

// API endpoint to get user by wallet (for username prefill)
app.get('/api/user/:wallet', async (req: any, res: any) => {
  try {
    const user = await (User as any).findOne({ walletAddress: req.params.wallet })
      .select('walletAddress username totalWinnings totalWagered gamesWon gamesPlayed')
      .lean();
    
    if (!user) {
      return res.json({ user: null });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// API endpoint to get user's recent games
app.get('/api/user/:wallet/games', async (req: any, res: any) => {
  try {
    const { wallet } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState !== 1) {
      return res.json({ games: [] });
    }
    
    // Find games where this wallet participated
    const sessions = await (GameSession as any)
      .find({ participants: wallet, status: 'completed' })
      .sort({ startTime: -1 })
      .limit(limit)
      .lean();
    
    // Transform to game format
    const games = sessions.map((session: any) => {
      const isWinner = session.winnerWallet === wallet;
      return {
        gameId: session.gameId,
        tier: session.tier,
        timestamp: session.startTime,
        isWinner,
        winnerName: session.winnerName || 'Unknown',
        potAmount: session.potSize || 0
      };
    });
    
    res.json({ games });
  } catch (error) {
    console.error('Error fetching user games:', error);
    res.status(500).json({ games: [], error: 'Failed to fetch games' });
  }
});

// Update username endpoint
app.post('/api/user/update-username', async (req: any, res: any) => {
  try {
    const { walletAddress, username } = req.body;
    
    if (!walletAddress || !username) {
      return res.status(400).json({ error: 'Wallet address and username required' });
    }
    
    const trimmedUsername = username.trim();
    
    if (trimmedUsername.length === 0 || trimmedUsername.length > 20) {
      return res.status(400).json({ error: 'Username must be 1-20 characters' });
    }
    
    // Update or create user with new username
    const user = await (User as any).findOneAndUpdate(
      { walletAddress },
      {
        $set: { username: trimmedUsername, lastActive: new Date() },
        $setOnInsert: { totalWinnings: 0, gamesWon: 0, gamesPlayed: 0 }
      },
      { upsert: true, new: true }
    );
    
    console.log(`📝 Username updated: ${trimmedUsername} (${walletAddress.substring(0, 8)}...)`);
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Error updating username:', error);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// API endpoint to get banned IPs (admin use)
app.get('/api/bans', (req: any, res: any) => {
  const bans = getAllBans();
  res.json({ bans, count: bans.length });
});

// API endpoint for x403 stats (admin/monitoring)
app.get('/api/auth/stats', async (req: any, res: any) => {
  try {
    // Get in-memory stats
    const { getX403Stats } = await import('./lib/x403.js');
    const memoryStats = getX403Stats();

    // Get database stats
    let dbStats = {
      totalSessions: 0,
      activeSessions: 0,
      expiredSessions: 0
    };

    try {
      const now = new Date();
      dbStats.totalSessions = await (AuthSession as any).countDocuments();
      dbStats.activeSessions = await (AuthSession as any).countDocuments({ expiresAt: { $gt: now } });
      dbStats.expiredSessions = await (AuthSession as any).countDocuments({ expiresAt: { $lte: now } });
    } catch (error) {
      console.warn('Could not fetch database stats:', error);
    }

    res.json({
      memory: memoryStats,
      database: dbStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching x403 stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// API endpoint for leaderboard (top 50 winners)
app.get('/api/leaderboard', async (req: any, res: any) => {
  try {
    const leaderboard = await (User as any).find()
      .sort({ totalWinnings: -1 })
      .limit(50)
      .select('walletAddress username totalWinnings gamesWon')
      .lean();
    
    res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// API endpoint to get chat messages
app.get('/api/chat', async (req: any, res: any) => {
  try {
    const messages = await (ChatMessage as any).find()
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    
    res.json({ messages: messages.reverse() }); // Reverse to show oldest first
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ error: 'Failed to fetch chat' });
  }
});

/**
 * x403 Session Logout
 * Invalidate session when user disconnects wallet
 */
app.post('/api/auth/logout', async (req: any, res: any) => {
  try {
    const { walletAddress, sessionToken } = req.body;

    if (!walletAddress && !sessionToken) {
      return res.status(400).json({ error: 'Wallet address or session token required' });
    }

    // Delete session from MongoDB
    let deletedCount = 0;

    if (sessionToken) {
      const result = await (AuthSession as any).deleteOne({ sessionToken });
      deletedCount = result.deletedCount || 0;
    } else if (walletAddress) {
      const result = await (AuthSession as any).deleteMany({ walletAddress });
      deletedCount = result.deletedCount || 0;
    }

    console.log(`🔓 x403: Logged out ${walletAddress?.slice(0, 8) || 'unknown'}... (${deletedCount} sessions deleted)`);

    return res.json({ success: true, sessionsDeleted: deletedCount });
  } catch (error: any) {
    console.error('❌ x403 logout error:', error);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * x403 Authentication Endpoint
 * Step 1: Client requests auth → Server returns 403 + challenge
 * Step 2: Client signs challenge → Server verifies and creates session
 */
app.post('/api/auth/challenge', async (req: any, res: any) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Check if wallet is rate limited
    const rateLimit = isRateLimited(walletAddress);
    if (rateLimit.limited) {
      return res.status(429).json({ 
        error: rateLimit.reason,
        unlockAt: rateLimit.unlockAt,
        rateLimited: true
      });
    }

    // Check if wallet already has active session
    try {
      const existingSession = await (AuthSession as any).findOne({
        walletAddress,
        expiresAt: { $gt: new Date() } // Not expired
      });

      if (existingSession) {
        console.log(`✅ x403: Existing session found for ${walletAddress.slice(0, 8)}...`);
        
        // Update last used
        existingSession.lastUsed = new Date();
        await existingSession.save();

        return res.json({
          authenticated: true,
          sessionToken: existingSession.sessionToken,
          expiresAt: existingSession.expiresAt,
          existingSession: true
        });
      }
    } catch (error) {
      console.warn('⚠️ Could not check existing session:', error);
    }

    // Generate new challenge
    const domain = req.headers.host || 'localhost';
    const authRequired = createAuthRequired(domain);

    console.log(`📋 x403: Challenge generated for ${walletAddress.slice(0, 8)}...`);
    console.log(`   Nonce: ${authRequired.challenge.nonce.slice(0, 16)}...`);
    console.log(`   Expires: ${new Date(authRequired.challenge.expiresAt).toISOString()}`);

    return res.status(403).json(authRequired);

  } catch (error: any) {
    console.error('❌ x403 challenge generation error:', error);
    return res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

/**
 * Verify signed challenge and create session
 */
app.post('/api/auth/verify', async (req: any, res: any) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(400).json({ error: 'Authorization header required' });
    }

    // Decode signed challenge
    const signedChallenge = decodeAuthHeader(authHeader);
    if (!signedChallenge) {
      return res.status(400).json({ error: 'Invalid authorization format' });
    }

    const { walletAddress } = signedChallenge;

    // Check rate limit
    const rateLimit = isRateLimited(walletAddress);
    if (rateLimit.limited) {
      return res.status(429).json({ 
        error: rateLimit.reason,
        unlockAt: rateLimit.unlockAt,
        rateLimited: true
      });
    }

    // Verify signature
    console.log(`🔍 x403: Verifying signature for ${walletAddress.slice(0, 8)}...`);
    
    const verification = verifySignature(signedChallenge);

    if (!verification.valid) {
      console.error(`❌ x403: Verification failed - ${verification.error}`);
      
      // Record failure for rate limiting
      recordAuthFailure(walletAddress);
      
      return res.status(403).json({ 
        error: verification.error,
        authenticated: false
      });
    }

    console.log(`✅ x403: Signature verified for ${walletAddress.slice(0, 8)}...`);

    // Clear any existing rate limits on successful auth
    clearRateLimit(walletAddress);

    // Create session token
    const { token: sessionToken, expiresAt } = createSessionToken(walletAddress, JWT_SECRET);

    // Store session in MongoDB
    try {
      await (AuthSession as any).create({
        walletAddress,
        sessionToken,
        createdAt: new Date(),
        expiresAt,
        lastUsed: new Date(),
        gamesPlayed: 0,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      });

      console.log(`✅ x403: Session created for ${walletAddress.slice(0, 8)}... (expires in 30 min)`);
    } catch (error) {
      console.warn('⚠️ x403: Failed to store session in MongoDB:', error);
      // Continue anyway - session token still works
    }

    return res.json({
      authenticated: true,
      sessionToken,
      expiresAt,
      walletAddress
    });

  } catch (error: any) {
    console.error('❌ x403 verification error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * x402 Payment Required Endpoint (with x403 Authentication)
 * Requires x403 session token in X-SESSION header
 * Client requests to join lobby, server returns 402 if payment needed
 * Client pays, then retries with X-PAYMENT header for verification
 */
app.post('/api/join-lobby', async (req: any, res: any) => {
  try {
    const { tier, playerId, playerName, walletAddress } = req.body;

    // Validation
    if (!tier || !playerId || !playerName) {
      return res.status(400).json({ error: 'Missing required fields: tier, playerId, playerName' });
    }

    // x403 AUTHENTICATION REQUIRED
    const sessionToken = req.headers['x-session'];
    
    if (!sessionToken) {
      return res.status(403).json({ 
        error: 'x403 authentication required. Please authenticate with your wallet first.',
        requiresAuth: true
      });
    }

    // Verify session token
    const sessionVerification = verifySessionToken(sessionToken as string, JWT_SECRET);

    if (!sessionVerification.valid) {
      return res.status(403).json({ 
        error: sessionVerification.error || 'Invalid session',
        requiresAuth: true
      });
    }

    // Verify session exists in database and update last used
    try {
      const session = await (AuthSession as any).findOne({
        sessionToken,
        expiresAt: { $gt: new Date() }
      });

      if (!session) {
        return res.status(403).json({ 
          error: 'Session expired or not found. Please authenticate again.',
          requiresAuth: true
        });
      }

      // Verify wallet address matches session
      if (session.walletAddress !== walletAddress) {
        return res.status(403).json({ 
          error: 'Wallet address mismatch',
          requiresAuth: true
        });
      }

      // Update last used timestamp
      session.lastUsed = new Date();
      await session.save();

      console.log(`✅ x403: Session validated for ${walletAddress.slice(0, 8)}...`);
    } catch (error) {
      console.warn('⚠️ x403: Could not verify session in database:', error);
      // Continue - JWT is still valid
    }

    // Find game mode
    const gameMode = config.gameModes.find(m => m.tier === tier);
    if (!gameMode) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Check if this tier requires payment
    const requiresPayment = gameMode.requiresPayment && tier !== 'dream';

    // Dream mode or free tier - no payment needed
    if (!requiresPayment) {
      // Generate free lobby token
      const lobbyToken = jwt.sign(
        {
          playerId,
          playerName,
          tier,
          walletAddress: walletAddress || null,
          txSignature: 'free',
          free: true
        } as LobbyAccessToken,
        JWT_SECRET,
        { expiresIn: '10m' }
      );

      return res.json({
        success: true,
        lobbyToken,
        free: true
      });
    }

    // Paid tier - check for X-PAYMENT header
    const paymentHeader = extractPaymentHeader(req);

    if (!paymentHeader) {
      // No payment provided → Return 402 Payment Required
      if (!walletManager) {
        return res.status(503).json({ error: 'Payment system not available' });
      }

      const paymentRequired = createPaymentRequired(
        tier,
        gameMode.buyIn,
        walletManager.getPlatformAddress(),
        process.env.USDC_MINT_ADDRESS || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );

      console.log(`📋 x402: Sent payment requirements for $${gameMode.buyIn} (Tier: $${tier})`);

      return res.status(402).json(paymentRequired);
    }

    // Payment provided - decode and verify
    const payment = decodePaymentPayload(paymentHeader);

    if (!payment || !validatePaymentPayload(payment)) {
      return res.status(400).json({ error: 'Invalid payment payload' });
    }

    // Validate payment details match requirements
    const expectedAmount = Math.floor(gameMode.buyIn * 1_000_000);
    if (parseInt(payment.payload.amount) < expectedAmount) {
      return res.status(402).json({ error: 'Insufficient payment amount' });
    }

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required for paid games' });
    }

    // Verify payment on Solana blockchain (x402 compliance!)
    if (!walletManager) {
      return res.status(503).json({ error: 'Payment verification unavailable' });
    }

    console.log('🔍 x402: Verifying payment on blockchain...');

    const verification = await walletManager.verifyPaymentTransaction(
      payment.payload.signature,
      payment.payload.from,
      gameMode.buyIn
    );

    if (!verification.valid) {
      console.error(`❌ x402: Payment verification failed - ${verification.error}`);
      return res.status(402).json({ 
        error: `Payment verification failed: ${verification.error}` 
      });
    }

    // Payment verified! Record it in database
    if (entryFeeService) {
      const lobbyId = `lobby_${tier}`;
      const paymentResult = await entryFeeService.collectEntryFee(
        playerId,
        playerName,
        walletAddress,
        lobbyId,
        tier,
        gameMode.buyIn,
        payment.payload.signature
      );

      if (!paymentResult.success) {
        return res.status(402).json({ error: `Payment recording failed: ${paymentResult.error}` });
      }

      // Add to lobby pot
      lobbyManager.addToPot(tier, gameMode.buyIn);
    }

    // Generate lobby access token (JWT)
    const lobbyToken = jwt.sign(
      {
        playerId,
        playerName,
        tier,
        walletAddress,
        txSignature: payment.payload.signature,
        free: false
      } as LobbyAccessToken,
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    console.log(`✅ x402: Payment verified, lobby token issued for ${playerName}`);

    return res.json({
      success: true,
      verified: true,
      lobbyToken,
      txSignature: payment.payload.signature
    });

  } catch (error: any) {
    console.error('❌ /api/join-lobby error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to get real client IP
function getClientIP(socket: any): string {
  // Check x-forwarded-for first (for proxies/CDNs like Vercel/Render/Cloudflare)
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be: "client, proxy1, proxy2"
    const ips = forwarded.split(',').map((ip: string) => ip.trim());
    return ips[0]; // First IP is the real client
  }
  
  // Fallback to socket address
  const address = socket.handshake.address;
  return address || 'unknown';
}

// Helper to mask IP for logging (privacy)
function maskIP(ip: string): string {
  if (ip === 'unknown') return 'unknown';
  const parts = ip.split('.');
  if (parts.length === 4) {
    // IPv4: show first 2 octets only
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  // IPv6: show first segment only
  return ip.split(':')[0] + ':xxxx';
}

// Function to ban IP and kick player
function banIPAndKick(ip: string, playerId: string, playerName: string, reason: string) {
  if (DEV_IP_WHITELIST.includes(ip)) {
    console.log(`⚠️ Skipping ban for whitelisted IP: ${maskIP(ip)}`);
    return;
  }
  
  bannedIPs.add(ip);
  saveBan(ip, playerName, reason); // Save to file for persistence
  console.log(`🚫 IP BANNED: ${maskIP(ip)} - Reason: ${reason} - Player: ${playerName}`);
  
  // Find and kick the player
  const game = lobbyManager.getGameForPlayer(playerId);
  if (game) {
    const player = game.players.get(playerId);
    if (player) {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('error', { message: 'You have been banned for cheating.', code: 403 });
        socket.disconnect();
        console.log(`⛔ Kicked ${playerName} from game`);
      }
    }
  }
  
  // Clear from active tracking
  activePlayersByIP.delete(ip);
  playerToLobby.delete(playerId);
}

// Helper to get IP for a player ID
function getClientIPForPlayer(playerId: string): string | null {
  const lobbyId = playerToLobby.get(playerId);
  if (!lobbyId) return null;
  
  const lobby = lobbyManager['lobbies'].get(lobbyId);
  if (!lobby) return null;
  
  const player = lobby.players.get(playerId);
  if (!player) return null;
  
  const socket = io.sockets.sockets.get(player.socketId);
  if (!socket) return null;
  
  return getClientIP(socket);
}

// Socket.io Events
io.on('connection', (socket) => {
  connectedClients++;
  const clientIP = maskIP(getClientIP(socket));
  const fullIP = getClientIP(socket);
  
  // Check if IP is banned
  if (bannedIPs.has(fullIP)) {
    console.log(`🚫 BANNED IP attempted connection: ${clientIP}`);
    socket.emit('error', { message: 'You have been banned.', code: 403 });
    socket.disconnect();
    connectedClients--;
    return;
  }
  
  // Check if IP is whitelisted (dev/localhost)
  const isWhitelisted = DEV_IP_WHITELIST.includes(fullIP);
  
  // Block multiple connections from same IP (except whitelisted)
  if (!isWhitelisted && fullIP !== 'unknown') {
    const existingConnection = activeConnectionsByIP.get(fullIP);
    
    if (existingConnection) {
      // Check if existing connection is still alive
      const existingSocket = io.sockets.sockets.get(existingConnection);
      
      if (existingSocket && existingSocket.connected) {
        console.log(`🚫 MULTIPLE CONNECTION BLOCKED: ${clientIP}`);
        console.log(`   Existing connection: ${existingConnection}`);
        console.log(`   New connection: ${socket.id}`);
        socket.emit('error', { 
          message: 'Multiple connections from the same network are not allowed. Please close other tabs.', 
          code: 429 
        });
        socket.disconnect();
        connectedClients--;
        return;
      } else {
        // Existing connection is dead, clean it up
        console.log(`🧹 Cleaning up dead connection from ${clientIP}`);
        activeConnectionsByIP.delete(fullIP);
      }
    }
    
    // Track this connection
    activeConnectionsByIP.set(fullIP, socket.id);
    console.log(`🔌 NEW CONNECTION: ${socket.id} from ${clientIP} (Total: ${connectedClients})`);
    console.log(`   IP tracked: ${maskIP(fullIP)} → ${socket.id}`);
  } else {
    console.log(`🔌 NEW CONNECTION: ${socket.id} from ${clientIP} (Total: ${connectedClients}) ${isWhitelisted ? '[WHITELISTED]' : ''}`);
  }
  
  broadcastStats();

  // Player reconnects to existing game
  socket.on('playerReconnect', ({ playerId, gameId }) => {
    const game = lobbyManager.getGame(gameId);
    if (game && game.players.has(playerId)) {
      // Update socket ID for reconnected player
      const player = game.players.get(playerId);
      if (player) {
        player.socketId = socket.id;
        socket.join(gameId);
        socket.emit('reconnected', { gameId });
        console.log(`Player ${playerId} reconnected to game ${gameId}`);
      }
    } else {
      // Game doesn't exist or player not in it, join new lobby
      socket.emit('gameNotFound');
    }
  });

  // Player joins lobby (with verified lobby token from x402 flow)
  socket.on('playerJoinLobby', async ({ lobbyToken }) => {
    // Verify and decode lobby token
    let tokenData: LobbyAccessToken;

    try {
      tokenData = jwt.verify(lobbyToken, JWT_SECRET) as LobbyAccessToken;
    } catch (error) {
      console.error('❌ Invalid lobby token:', error);
      socket.emit('lobbyError', { message: 'Invalid or expired lobby token' });
      return;
    }

    // Extract data from verified token
    const { playerId, playerName, tier, walletAddress, txSignature, free } = tokenData;

    console.log(`🎟️  Verified lobby token for ${playerName} → $${tier} tier (${free ? 'FREE' : 'PAID'})`);

    // Get client IP using helper function
    const ipString = getClientIP(socket);
    const maskedIP = maskIP(ipString);
    
    // Check if IP is whitelisted (dev testing)
    const isWhitelisted = DEV_IP_WHITELIST.includes(ipString);
    
    // Anti-farming: Check if this IP already has an active player in a lobby or game
    if (!isWhitelisted && ipString !== 'unknown') {
      const existingPlayers = activePlayersByIP.get(ipString) || new Set();
      
      if (existingPlayers.size > 0) {
        console.log(`🚫 Connection from ${maskedIP} blocked - already has ${existingPlayers.size} active game(s)`);
        socket.emit('error', { 
          message: 'Only one game per connection allowed. Please wait for your current game to finish.',
          code: 429 
        });
        return;
      }
    }
    
    // Create/update user record in database
    if (walletAddress && playerName) {
      try {
        const user = await (User as any).findOneAndUpdate(
          { walletAddress },
          {
            $set: { username: playerName, lastActive: new Date() },
            // $inc: { gamesPlayed: 1 }, // Moved to lobbyManager (free) and entryFeeService (paid) to prevent double counting
            $setOnInsert: { totalWinnings: 0, gamesWon: 0, gamesPlayed: 0 }
          },
          { upsert: true, new: true }
        );
        console.log(`👤 User updated: ${playerName} (${user.gamesPlayed} games played)`);
      } catch (error) {
        console.error('❌ Failed to save user:', error);
      }
    }
    
    // Store wallet address if provided
    if (walletAddress) {
      playerWallets.set(playerId, walletAddress);
      const shortWallet = `${walletAddress.substring(0, 8)}...${walletAddress.substring(walletAddress.length - 4)}`;
      console.log(`💼 Wallet: ${playerName} → ${shortWallet}`);
    }
    
    // Payment already verified by x402 endpoint - pot already updated
    // Just validate that paid games have payment
    const gameMode = config.gameModes.find(m => m.tier === tier);
    const requiresPayment = gameMode?.requiresPayment && tier !== 'dream';
    
    if (requiresPayment && free) {
      socket.emit('lobbyError', { message: 'Payment required for this tier' });
        return;
    }
    
    const result = lobbyManager.joinLobby(socket.id, playerId, playerName, tier, walletAddress);
    
    if (result.success) {
      const lobbyId = `lobby_${tier}`;
      socket.join(lobbyId);
      
      // Track which lobby this player is in
      playerToLobby.set(playerId, lobbyId);
      
      // Track this player under their IP address
      const ipString = getClientIP(socket);
      
      if (ipString !== 'unknown') {
        if (!activePlayersByIP.has(ipString)) {
          activePlayersByIP.set(ipString, new Set());
        }
        activePlayersByIP.get(ipString)!.add(playerId);
        console.log(`📊 ${playerName} joined from ${maskIP(ipString)} (${activePlayersByIP.get(ipString)!.size} active from this network)`);
      }
      
      console.log(`✅ x402: Player ${playerName} successfully joined lobby ${lobbyId}`);
      socket.emit('lobbyJoined', { lobbyId, tier });
      
      // Immediately send lobby status to this player
      const status = lobbyManager.getLobbiesStatus().find(l => l.tier === tier);
      if (status) {
        socket.emit('lobbyUpdate', {
          tier: status.tier,
          playersLocked: status.playersCount,
          maxPlayers: status.maxPlayers,
          countdown: status.countdown,
          status: status.status,
          spectatorCount: status.spectatorCount,
        });
      }
    } else {
      console.error(`❌ x402: Lobby join failed for ${playerName}: ${result.message}`);
      socket.emit('lobbyError', { message: result.message });
    }
  });

  // Join as spectator (from homepage)
  socket.on('joinAsSpectator', ({ tier }) => {
    console.log(`🎥 NEW SPECTATOR request for tier ${tier} from socket ${socket.id}`);
    const result = lobbyManager.joinAsSpectator(socket.id, tier);
    
    console.log(`Spectator join result:`, result);
    
    if (result.success && result.gameId) {
      socket.join(result.gameId);
      socket.emit('spectatorJoined', { gameId: result.gameId, tier });
      console.log(`✅ SPECTATOR ${socket.id} joined game ${result.gameId}`);
      broadcastStats();
    } else {
      console.error(`❌ SPECTATOR JOIN FAILED: ${result.message}`);
      socket.emit('error', { message: result.message || 'Could not join as spectator', code: 400 });
    }
  });

  // Player becomes spectator after dying
  socket.on('becomeSpectator', ({ playerId, gameId }) => {
    console.log(`💀 Player ${playerId} became spectator in game ${gameId}`);
    const game = lobbyManager.getGame(gameId);
    if (game) {
      game.gameState.spectators.add(socket.id);
      console.log(`Spectator count now: ${game.gameState.spectators.size}`);
      broadcastStats();
    }
  });

  // Player movement
  socket.on('playerMove', ({ playerId, x, y, gameId }) => {
    const game = lobbyManager.getGame(gameId);
    if (game) {
      game.handlePlayerMove(playerId, x, y);
    }
  });

  // Player boost (replaces split/eject for snake game)
  socket.on('playerBoost', ({ playerId, gameId, boosting }) => {
    const game = lobbyManager.getGame(gameId);
    if (game) {
      game.handlePlayerBoost(playerId, boosting);
    }
  });

  // Player leaves lobby (explicit)
  socket.on('playerLeaveLobby', async ({ playerId }) => {
    console.log(`👋 Player ${playerId} explicitly leaving lobby`);
    
    // GUARD 1: Check if already refunded
    if (refundedPlayers.has(playerId)) {
      console.log(`⚠️ Player ${playerId} already refunded - skipping`);
      lobbyManager.leaveLobby(playerId);
      playerToLobby.delete(playerId);
      return;
    }
    
    // GUARD 2: Check if refund is already in progress (concurrent calls)
    if (refundsInProgress.has(playerId)) {
      console.log(`⚠️ Refund already in progress for ${playerId} - waiting for completion`);
      await refundsInProgress.get(playerId); // Wait for it to complete
      lobbyManager.leaveLobby(playerId);
      playerToLobby.delete(playerId);
      return;
    }
    
    // Check if player should get a refund (game not started yet)
    const lobbyId = playerToLobby.get(playerId);
    if (lobbyId && entryFeeService) {
      const lobby = lobbyManager['lobbies'].get(lobbyId);
      
      // Refund if game hasn't started (waiting or countdown)
      if (lobby && (lobby.status === 'waiting' || lobby.status === 'countdown')) {
        const walletAddress = playerWallets.get(playerId);
        const tier = lobby.tier;
        const gameMode = config.gameModes.find(m => m.tier === tier);
        
        if (walletAddress && gameMode?.requiresPayment && tier !== 'dream') {
          const entryFee = gameMode.buyIn;
          
          // Find player name from lobby
          const player = lobby.players.get(playerId);
          const playerName = player?.name || 'Unknown';
          
          console.log(`💸 Starting refund for ${playerName} (explicit leave, $${entryFee})`);
          
          // Mark as refunded IMMEDIATELY and track the promise
          refundedPlayers.add(playerId);
          
          const refundPromise = entryFeeService.refundEntryFee(
            playerId,
            playerName,
            walletAddress,
            entryFee,
            lobbyId,
            tier
          ).then((result: any) => {
            refundsInProgress.delete(playerId); // Clean up immediately after completion
            return result;
          });
          
          refundsInProgress.set(playerId, refundPromise);
          const refundResult = await refundPromise;
          
          if (refundResult.success) {
            socket.emit('refundProcessed', { amount: entryFee, tx: refundResult.txSignature });
            // Remove from lobby pot ONLY if transaction was successful
            lobbyManager.removeFromPot(tier, entryFee);
          } else {
            console.error(`❌ Refund failed: ${refundResult.error}`);
            socket.emit('refundFailed', { error: refundResult.error });
            // Remove from refunded set if refund failed
            refundedPlayers.delete(playerId);
          }
        }
      }
    }
    
    lobbyManager.leaveLobby(playerId);
    playerToLobby.delete(playerId);
    
    // Clean up refund tracking (will be removed again on disconnect, but good to clean up)
    setTimeout(() => {
      if (refundedPlayers.has(playerId)) {
        refundedPlayers.delete(playerId);
      }
    }, 10000); // Clean up after 10 seconds if socket doesn't disconnect
    
    // Remove from IP tracking
    const ipString = getClientIP(socket);
    
    if (ipString !== 'unknown' && activePlayersByIP.has(ipString)) {
      activePlayersByIP.get(ipString)!.delete(playerId);
      if (activePlayersByIP.get(ipString)!.size === 0) {
        activePlayersByIP.delete(ipString);
      }
      console.log(`📊 Player left from ${maskIP(ipString)} (${activePlayersByIP.get(ipString)?.size || 0} remaining)`);
    }
    
    broadcastStats();
  });

  // Player leaves spectate mode
  socket.on('leaveSpectate', ({ gameId }) => {
    console.log(`👁️ Spectator ${socket.id} requesting to leave game ${gameId}`);
    const game = lobbyManager.getGame(gameId);
    if (game) {
      const hadSpectator = game.gameState.spectators.has(socket.id);
      game.gameState.spectators.delete(socket.id);
      console.log(`Spectator removed: ${hadSpectator ? 'YES' : 'NO (was not in set)'}`);
      console.log(`Spectator count now: ${game.gameState.spectators.size}`);
      console.log(`Total spectators across all games: ${lobbyManager.getTotalSpectators()}`);
      broadcastStats();
    } else {
      console.log(`⚠️ Game ${gameId} not found for spectator leave`);
    }
  });

  // Global chat message
  socket.on('chatMessage', async ({ username, message, walletAddress }) => {
    if (!username || !message || message.length > 200) return;
    
    const trimmedUsername = username.trim();
    const trimmedMessage = message.trim();
    
    // Create/update user record if wallet provided
    if (walletAddress) {
      try {
        await (User as any).findOneAndUpdate(
          { walletAddress },
          {
            $set: { username: trimmedUsername, lastActive: new Date() },
            $setOnInsert: { totalWinnings: 0, gamesWon: 0, gamesPlayed: 0 }
          },
          { upsert: true }
        );
        console.log(`👤 User created/updated via chat: ${trimmedUsername}`);
      } catch (error) {
        console.error('❌ Failed to create user from chat:', error);
      }
    }
    
    // Save chat message to database
    try {
      await (ChatMessage as any).create({
        username: trimmedUsername,
        message: trimmedMessage,
        timestamp: Date.now()
      });
      console.log(`💬 Chat saved: ${trimmedUsername}: ${trimmedMessage}`);
    } catch (error) {
      console.error('❌ Failed to save chat to DB:', error);
    }
    
    // Broadcast to all connected clients
    io.emit('chatMessage', {
      username: trimmedUsername,
      message: trimmedMessage
    });
  });

  // Player disconnects
  socket.on('disconnect', async () => {
    connectedClients--;
    const clientIP = maskIP(getClientIP(socket));
    const fullIP = getClientIP(socket);
    
    console.log(`🔌 DISCONNECT: ${socket.id} from ${clientIP} (Total: ${connectedClients})`);
    
    // Remove from connection tracking
    if (fullIP !== 'unknown') {
      const trackedSocket = activeConnectionsByIP.get(fullIP);
      if (trackedSocket === socket.id) {
        activeConnectionsByIP.delete(fullIP);
        console.log(`   IP connection freed: ${maskIP(fullIP)}`);
      }
    }
    
    // Find and remove player from lobby if they were in one
    let playerIdToRemove: string | null = null;
    for (const [playerId, lobbyId] of playerToLobby.entries()) {
      // Find player by socket ID
      const lobby = lobbyManager['lobbies'].get(lobbyId);
      if (lobby) {
        for (const [pid, player] of lobby.players.entries()) {
          if (player.socketId === socket.id) {
            playerIdToRemove = pid;
            break;
          }
        }
      }
      if (playerIdToRemove) break;
    }
    
    if (playerIdToRemove) {
      // Get lobby from playerToLobby map
      const lobbyId = playerToLobby.get(playerIdToRemove);
      let playerName = playerIdToRemove;
      let shouldRefund = false;
      let lobby = null;
      
      if (lobbyId) {
        // Access lobby directly from lobbyManager's private lobbies map
        lobby = lobbyManager['lobbies'].get(lobbyId);
        if (lobby) {
          const player = lobby.players.get(playerIdToRemove);
          playerName = player?.name || playerIdToRemove;
          
          // Check if refund should be processed (game not started yet)
          shouldRefund = lobby.status === 'waiting' || lobby.status === 'countdown';
        }
      }
      
      console.log(`👋 PLAYER LEFT: ${playerName} disconnected`);
      
      // GUARD 1: Check if already refunded or in progress
      if (refundedPlayers.has(playerIdToRemove)) {
        console.log(`✅ Skipping auto-refund for ${playerName} - already refunded`);
        shouldRefund = false;
      }
      
      // GUARD 2: Check if refund operation is in progress
      if (refundsInProgress.has(playerIdToRemove)) {
        console.log(`⚠️ Refund already in progress for ${playerName} - waiting...`);
        await refundsInProgress.get(playerIdToRemove); // Wait for it
        shouldRefund = false;
      }
      
      // Process refund if applicable
      if (shouldRefund && lobby && entryFeeService) {
        const walletAddress = playerWallets.get(playerIdToRemove);
        const tier = lobby.tier;
        const gameMode = config.gameModes.find(m => m.tier === tier);
        
        if (walletAddress && gameMode?.requiresPayment && tier !== 'dream') {
          const entryFee = gameMode.buyIn;
          
          console.log(`💸 Starting auto-refund for ${playerName} ($${entryFee}) - Socket: ${socket.id}`);
          
          // Mark as refunded IMMEDIATELY and track the promise
          refundedPlayers.add(playerIdToRemove);
          
          const refundPromise = entryFeeService.refundEntryFee(
            playerIdToRemove,
            playerName,
            walletAddress,
            entryFee,
            lobbyId!,
            tier
          ).then((result: any) => {
            refundsInProgress.delete(playerIdToRemove); // Clean up immediately
            return result;
          });
          
          refundsInProgress.set(playerIdToRemove, refundPromise);
          const refundResult = await refundPromise;
          
          if (refundResult.success) {
            console.log(`✅ Auto-refund successful for ${playerName}, updating pot...`);
            // Remove from lobby pot ONLY if transaction was successful
            lobbyManager.removeFromPot(tier, entryFee);
          } else {
            console.error(`❌ Auto-refund failed for ${playerName}: ${refundResult.error}`);
            // Remove from refunded set if refund failed
            refundedPlayers.delete(playerIdToRemove);
          }
        }
      }
      
      lobbyManager.leaveLobby(playerIdToRemove);
      playerToLobby.delete(playerIdToRemove);
      
      // DON'T delete from refundedPlayers yet - keep it to prevent duplicate refunds
      // Clean up after 5 minutes to prevent memory leak
      if (refundedPlayers.has(playerIdToRemove)) {
        setTimeout(() => {
          refundedPlayers.delete(playerIdToRemove);
          console.log(`🧹 Cleaned up refund tracking for ${playerIdToRemove}`);
        }, 5 * 60 * 1000); // 5 minutes
      }
      
      // Remove from IP tracking
      const ipString = getClientIP(socket);
      
      if (ipString !== 'unknown' && activePlayersByIP.has(ipString)) {
        activePlayersByIP.get(ipString)!.delete(playerIdToRemove);
        if (activePlayersByIP.get(ipString)!.size === 0) {
          activePlayersByIP.delete(ipString);
        }
        console.log(`📊 IP cleared: ${maskIP(ipString)} (${activePlayersByIP.get(ipString)?.size || 0} remaining)`);
      }
      
      // Keep wallet address for payout even if disconnected
    }
    
    let wasSpectator = false;
    
    // Remove from spectators in all games
    for (const game of lobbyManager['games'].values()) {
      if (game.gameState.spectators.has(socket.id)) {
        game.gameState.spectators.delete(socket.id);
        wasSpectator = true;
        console.log(`👁️ Removed spectator ${socket.id} from game ${game.id} (${game.gameState.spectators.size} remaining)`);
      }
    }
    
    if (wasSpectator) {
      console.log(`Total spectators after cleanup: ${lobbyManager.getTotalSpectators()}`);
    }
    
    // Broadcast updated stats after cleanup
    console.log(`📊 Broadcasting stats: ${connectedClients} connected, ${lobbyManager.getPlayersInGameCount()} in game, ${lobbyManager.getTotalSpectators()} spectating`);
    broadcastStats();
  });
});

// Set lobby reset callback to clear IP tracking
lobbyManager.setLobbyResetCallback((playerIds: string[]) => {
  console.log(`🧹 Lobby reset - clearing IP tracking for ${playerIds.length} players`);
  
  for (const playerId of playerIds) {
    // Find and remove this player from IP tracking
    for (const [ip, players] of activePlayersByIP.entries()) {
      if (players.has(playerId)) {
        players.delete(playerId);
        if (players.size === 0) {
          activePlayersByIP.delete(ip);
        }
        console.log(`   Cleared ${playerId} from ${maskIP(ip)}`);
      }
    }
  }
});

// Set cheat detection callback to ban cheaters
lobbyManager.setCheatDetectionCallback((playerId: string, playerName: string, reason: string) => {
  const ipString = getClientIPForPlayer(playerId);
  if (ipString && ipString !== 'unknown') {
    banIPAndKick(ipString, playerId, playerName, reason);
  }
});

// Start lobby broadcast loop
lobbyManager.broadcastLobbyUpdates();

// Start stats broadcast loop (every 2 seconds to keep counts accurate)
let statsBroadcastCount = 0;
setInterval(() => {
  statsBroadcastCount++;
  
  // Clean up disconnected spectators before calculating stats
  lobbyManager.cleanupDisconnectedSpectators(io);
  
  const playersInGame = lobbyManager.getPlayersInGameCount();
  const totalSpectators = lobbyManager.getTotalSpectators();
  
  // Only log every 10 broadcasts (every 20 seconds) to avoid spam
  if (statsBroadcastCount % 10 === 0) {
    console.log(`📊 [Periodic] Stats: ${connectedClients} connected | ${playersInGame} in game | ${totalSpectators} spectating | ${connectedClients - playersInGame - totalSpectators} browsing`);
  }
  
  broadcastStats();
}, 2000);

// Start server
const PORT = config.server.port;
httpServer.listen(PORT, () => {
  console.log(`🐍 SlitherFi Server running on port ${PORT}`);
  console.log(`   Tick Rate: ${config.server.tickRate}Hz`);
  console.log(`   Map Size: ${config.game.mapWidth}x${config.game.mapHeight}`);
  console.log(`   Min Players: ${config.lobby.minPlayers}`);
  console.log(`   Auto-fill Bots: ${config.dev.autoFillBots}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   MIN_PLAYERS_DEV: ${process.env.MIN_PLAYERS_DEV}`);
});

// Graceful shutdown handlers
const shutdown = (signal: string) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  httpServer.close(() => {
    console.log('HTTP server closed');
  });

  // Shutdown lobby manager and all games
  lobbyManager.shutdown();

  // Give time for cleanup then exit
  setTimeout(() => {
    console.log('Graceful shutdown complete');
    process.exit(0);
  }, 2000);
};

// Handle various shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));  // Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // Kill command
process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Nodemon restart

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('UNHANDLED_REJECTION');
});


