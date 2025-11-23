import { WalletManager } from './walletManager.js';
import { config } from '../config.js';
import mongoose from 'mongoose';

export interface DistributionResult {
  success: boolean;
  winnerTx?: string;
  burnTx?: string;
  error?: string;
  totalPot: number;
  winnerAmount: number;
  platformAmount: number;
  burnAmount: number;
}

/**
 * Distribution Service - Handles pot distribution (80% winner, 15% platform, 5% burn)
 */
export class DistributionService {
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
  }

  /**
   * Distribute pot: 80% to winner, 15% stays in platform, 5% to burn wallet
   */
  async distributePot(
    sessionId: string,
    tier: string,
    totalPot: number,
    paidPlayers: number,
    winnerWallet: string,
    winnerName: string,
    isBotWinner: boolean,
    entryFeeService?: any
  ): Promise<DistributionResult> {
    try {
      console.log('\n══════════════════════════════════════════════════════════════════════');
      console.log(`💰 INITIATING POT DISTRIBUTION: ${sessionId}`);
      console.log('══════════════════════════════════════════════════════════════════════');
      console.log(`📊 Game Details:`);
      console.log(`   Tier: $${tier}`);
      console.log(`   Paid Players: ${paidPlayers}`);
      console.log(`   Total Collected: $${totalPot.toFixed(2)} USDC`);
      console.log(`   Winner: ${winnerName}${isBotWinner ? ' (BOT - will pay highest human)' : ''}`);
      console.log('──────────────────────────────────────────────────────────────────────');

      // IMMEDIATELY clear payment records to prevent accumulation in next game
      // Note: Use lobby ID (extract from sessionId) for payment clearing
      const lobbyId = sessionId.split('_').slice(0, 2).join('_'); // "lobby_1_timestamp" -> "lobby_1"
      if (entryFeeService) {
        await entryFeeService.clearLobbyPayments(lobbyId);
        console.log(`🧹 Payment records cleared for ${lobbyId} (prevents pot accumulation)\n`);
      }

      // Calculate distribution
      const winnerAmount = Number((totalPot * (config.payment.winnerPercentage / 100)).toFixed(2));
      const platformAmount = Number((totalPot * (config.payment.platformPercentage / 100)).toFixed(2));
      const burnAmount = Number((totalPot * (config.payment.burnPercentage / 100)).toFixed(2));

      console.log(`\n📊 CALCULATED DISTRIBUTION:`);
      console.log(`   🏆 Winner (${config.payment.winnerPercentage}%):   $${winnerAmount.toFixed(2).padStart(10)} → ${winnerWallet}`);
      console.log(`   🏦 Platform (${config.payment.platformPercentage}%): $${platformAmount.toFixed(2).padStart(10)} → (stays in treasury)`);
      console.log(`   🔥 Burn (${config.payment.burnPercentage}%):     $${burnAmount.toFixed(2).padStart(10)} → ${config.payment.burnWalletAddress}`);
      console.log(`   ───────────────────────────`);
      console.log(`   💵 TOTAL:      $${totalPot.toFixed(2).padStart(10)}`);

      // Check platform has enough balance
      const requiredBalance = winnerAmount + burnAmount;
      const platformBalance = await this.walletManager.getUSDCBalance();
      
      console.log(`\n🏦 TREASURY PRE-FLIGHT CHECK:`);
      console.log(`   Current Balance: $${platformBalance.toFixed(2)}`);
      console.log(`   Required: $${requiredBalance.toFixed(2)} (Winner $${winnerAmount} + Burn $${burnAmount})`);
      console.log(`   Remaining After: $${(platformBalance - requiredBalance + platformAmount).toFixed(2)}`);
      
      if (platformBalance < requiredBalance) {
        const error = `Insufficient platform balance: need $${requiredBalance}, have $${platformBalance}`;
        console.error('\n❌ '.repeat(35));
        console.error(`INSUFFICIENT FUNDS: ${error}`);
        console.error('❌ '.repeat(35) + '\n');
        return {
          success: false,
          error,
          totalPot,
          winnerAmount,
          platformAmount,
          burnAmount,
        };
      }

      console.log('   ✅ Sufficient balance');
      
      // 1. Pay winner (80%)
      console.log(`\n💸 STEP 1/2: PAYING WINNER`);
      console.log(`   Amount: $${winnerAmount.toFixed(2)}`);
      console.log(`   From: Treasury (${this.walletManager.getPlatformAddress()})`);
      console.log(`   To: ${winnerWallet}`);
      
      // Check/create winner's USDC account
      try {
        const hasATA = await this.walletManager.hasUSDCAccount(winnerWallet);
        if (!hasATA) {
          console.log(`📝 Creating USDC account for winner...`);
          await this.walletManager.createUSDCAccount(winnerWallet);
        }
      } catch (error: any) {
        console.error(`❌ Failed to prepare winner account:`, error);
        return {
          success: false,
          error: `Failed to prepare winner account: ${error.message}`,
          totalPot,
          winnerAmount,
          platformAmount,
          burnAmount,
        };
      }

      const winnerTx = await this.walletManager.transferUSDC(
        winnerWallet,
        winnerAmount,
        sessionId,
        `${tier}_WIN`
      );
      console.log(`   ✅ SUCCESS!`);
      console.log(`   TX Signature: ${winnerTx}`);
      console.log(`   View: https://solscan.io/tx/${winnerTx}`);
      
      // 2. Send to burn wallet (5%)
      console.log(`\n🔥 STEP 2/2: SENDING TO BURN WALLET`);
      console.log(`   Amount: $${burnAmount.toFixed(2)}`);
      const burnWallet = config.payment.burnWalletAddress;
      console.log(`   From: Treasury (${this.walletManager.getPlatformAddress()})`);
      console.log(`   To: ${burnWallet}`);
      
      // Check/create burn wallet's USDC account
      try {
        const hasATA = await this.walletManager.hasUSDCAccount(burnWallet);
        if (!hasATA) {
          console.log(`📝 Creating USDC account for burn wallet...`);
          await this.walletManager.createUSDCAccount(burnWallet);
        }
      } catch (error: any) {
        console.error(`❌ Failed to prepare burn account:`, error);
        // Winner already paid, so continue but log error
        console.warn(`⚠️ Burn transfer skipped due to account error`);
      }

      const burnTx = await this.walletManager.transferUSDC(
        burnWallet,
        burnAmount,
        sessionId,
        `${tier}_BURN`
      );
      console.log(`   ✅ SUCCESS!`);
      console.log(`   TX Signature: ${burnTx}`);
      console.log(`   View: https://solscan.io/tx/${burnTx}`);
      
      // 3. Platform fee (15%) - already in platform wallet, no transfer needed
      console.log(`\n🏦 PLATFORM FEE (NO TRANSFER NEEDED):`);
      console.log(`   Amount: $${platformAmount.toFixed(2)}`);
      console.log(`   Status: Already in treasury from entry fees`);
      console.log(`   Wallet: ${this.walletManager.getPlatformAddress()}`);

      // Save distribution to database
      if (mongoose.connection.readyState === 1) {
        const { GameDistribution } = await import('../models/GameDistribution.js');
        const { Transaction } = await import('../models/Transaction.js');
        const { User } = await import('../models/User.js');
        
        // Check if distribution already exists (prevent duplicates using sessionId)
        const existing = await (GameDistribution as any).findOne({ gameId: sessionId });
        if (existing) {
          console.log(`\n⚠️  Distribution already saved for ${sessionId} - skipping duplicate`);
          return {
            success: true,
            winnerTx,
            burnTx,
            totalPot,
            winnerAmount,
            platformAmount,
            burnAmount,
          };
        }
        
        // Save distribution record (use sessionId for uniqueness)
        await (GameDistribution as any).create({
          gameId: sessionId,
          tier,
          paidPlayers,
          totalPot,
          winnerPayout: winnerAmount,
          winnerWallet,
          winnerTx,
          platformFee: platformAmount,
          burnAmount,
          burnWallet,
          burnTx,
          botWinner: isBotWinner,
          timestamp: Date.now(),
        });
        
        // Save transaction record for Payouts component (use sessionId for unique ID)
        await (Transaction as any).create({
          id: `dist_${sessionId}_${Date.now()}`,
          gameId: sessionId,
          tier,
          winnerId: 'unknown', // We don't have playerId here
          winnerName: winnerName,
          walletAddress: winnerWallet,
          amountUSDC: winnerAmount,
          txSignature: winnerTx,
          status: 'success',
          timestamp: Date.now(),
        });
        
        // Update user stats (totalWinnings, gamesWon) for leaderboard
        await (User as any).findOneAndUpdate(
          { walletAddress: winnerWallet },
          { 
            $inc: { totalWinnings: winnerAmount, gamesWon: 1 },
            $set: { username: winnerName, lastActive: new Date() }
          },
          { upsert: true }
        );
        
        console.log(`\n📝 Transaction logged to database (transactions collection)`);
        console.log(`📊 User stats updated for leaderboard`);
      } else {
        console.warn(`\n⚠️  MongoDB not connected - distribution not saved to database`);
      }

      console.log('\n');
      console.log('╔══════════════════════════════════════════════════════════════════════╗');
      console.log('║                  💰 FINAL DISTRIBUTION SUMMARY                       ║');
      console.log('╠══════════════════════════════════════════════════════════════════════╣');
      console.log(`║ Session ID:       ${sessionId.padEnd(52)} ║`);
      console.log(`║ Tier:             $${tier.padEnd(51)} ║`);
      console.log(`║ Paid Players:     ${paidPlayers.toString().padEnd(52)} ║`);
      console.log(`║ Winner:           ${winnerName.padEnd(52)} ║`);
      if (isBotWinner) {
        console.log(`║ ⚠️  Bot Winner:    TRUE (Paid highest human instead)${' '.repeat(17)} ║`);
      }
      console.log('╠══════════════════════════════════════════════════════════════════════╣');
      console.log(`║ 💵 TOTAL POT COLLECTED:           $${totalPot.toFixed(2).padStart(28)} ║`);
      console.log('╠══════════════════════════════════════════════════════════════════════╣');
      console.log('║                                                                      ║');
      console.log(`║ 🏆 WINNER PAYOUT (${config.payment.winnerPercentage}%)              $${winnerAmount.toFixed(2).padStart(28)} ║`);
      console.log(`║    📍 Destination: ${winnerWallet.padEnd(47)} ║`);
      console.log(`║    📝 TX Signature: ${winnerTx.substring(0, 44).padEnd(45)} ║`);
      console.log(`║    🔗 View: https://solscan.io/tx/${winnerTx.substring(0, 22).padEnd(23)} ║`);
      console.log('║                                                                      ║');
      console.log('╠══════════════════════════════════════════════════════════════════════╣');
      console.log('║                                                                      ║');
      console.log(`║ 🏦 PLATFORM FEE (${config.payment.platformPercentage}%)              $${platformAmount.toFixed(2).padStart(28)} ║`);
      console.log(`║    📍 Location: TREASURY (${this.walletManager.getPlatformAddress().substring(0, 28).padEnd(29)} ║`);
      console.log(`║    📝 Action: RETAINED (No transfer - already collected)${' '.repeat(11)} ║`);
      console.log('║                                                                      ║');
      console.log('╠══════════════════════════════════════════════════════════════════════╣');
      console.log('║                                                                      ║');
      console.log(`║ 🔥 BURN AMOUNT (${config.payment.burnPercentage}%)                $${burnAmount.toFixed(2).padStart(28)} ║`);
      console.log(`║    📍 Destination: ${burnWallet.padEnd(47)} ║`);
      console.log(`║    📝 TX Signature: ${burnTx.substring(0, 44).padEnd(45)} ║`);
      console.log(`║    🔗 View: https://solscan.io/tx/${burnTx.substring(0, 22).padEnd(23)} ║`);
      console.log('║                                                                      ║');
      console.log('╠══════════════════════════════════════════════════════════════════════╣');
      console.log(`║ ✅ ALL TRANSFERS COMPLETE - POT FULLY DISTRIBUTED                   ║`);
      console.log('╚══════════════════════════════════════════════════════════════════════╝');
      console.log('\n');

      return {
        success: true,
        winnerTx,
        burnTx,
        totalPot,
        winnerAmount,
        platformAmount,
        burnAmount,
      };
    } catch (error: any) {
      console.error(`❌ Distribution failed:`, error);
      return {
        success: false,
        error: error.message,
        totalPot,
        winnerAmount: 0,
        platformAmount: 0,
        burnAmount: 0,
      };
    }
  }
}

