import { WalletManager } from './walletManager.js';
import mongoose from 'mongoose';

export interface EntryFeePayment {
  success: boolean;
  txSignature?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  txSignature?: string;
  error?: string;
}

/**
 * Entry Fee Service - Handles collecting entry fees and refunds
 */
export class EntryFeeService {
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
  }

  /**
   * Collect entry fee from player
   * Player must send USDC to platform wallet before joining
   */
  async collectEntryFee(
    playerId: string,
    playerName: string,
    walletAddress: string,
    lobbyId: string,
    tier: string,
    entryFee: number,
    txSignature: string
  ): Promise<EntryFeePayment> {
    try {
      const separator = '══════════════════════════════════════════════════════════════════════';
      console.log('\n' + separator);
      console.log(`💳 ENTRY FEE COLLECTED`);
      console.log(separator);

      // Verify MongoDB connection
      if (mongoose.connection.readyState !== 1) {
        console.warn('⚠️ MongoDB not connected - payment not recorded');
      } else {
        // Save payment record to database
        const { LobbyPayment } = await import('../models/LobbyPayment.js');
        const { User } = await import('../models/User.js');
        
        // Check if payment already exists (prevent double-recording by tx OR by player+lobby)
        const existingByTx = await (LobbyPayment as any).findOne({ txSignature });
        if (existingByTx) {
          console.log(`ℹ️ Payment already recorded by TX: ${txSignature}`);
          return {
            success: true,
            txSignature,
          };
        }

        const existingByPlayer = await (LobbyPayment as any).findOne({ 
          playerId, 
          lobbyId,
          status: 'paid' 
        });
        if (existingByPlayer) {
          console.warn(`⚠️ Player ${playerId} already has paid entry for ${lobbyId} - deleting old record`);
          await (LobbyPayment as any).deleteOne({ _id: existingByPlayer._id });
        }

        await (LobbyPayment as any).create({
          playerId,
          lobbyId,
          tier,
          walletAddress,
          entryFee,
          txSignature,
          status: 'paid',
          timestamp: Date.now(),
        });

        // Update user stats: increment totalWagered and gamesPlayed
        await (User as any).findOneAndUpdate(
          { walletAddress },
          {
            $inc: { totalWagered: entryFee, gamesPlayed: 1 },
            $set: { username: playerName, lastActive: new Date() },
            $setOnInsert: { totalWinnings: 0, gamesWon: 0 }
          },
          { upsert: true }
        );
        console.log(`📊 User stats updated: ${playerName} (+$${entryFee} wagered, +1 game)`);

        console.log(`   Player: ${playerName}`);
        console.log(`   Wallet: ${walletAddress}`);
        console.log(`   Amount: $${entryFee} USDC`);
        console.log(`   Lobby: ${lobbyId} (Tier: $${tier})`);
        console.log(`   TX: ${txSignature}`);
        console.log(`   View: https://solscan.io/tx/${txSignature}`);
        console.log(separator + '\n');
      }

      return {
        success: true,
        txSignature,
      };
    } catch (error: any) {
      console.error(`❌ Failed to record entry fee:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Refund entry fee to player
   * Only allowed before game starts
   */
  async refundEntryFee(
    playerId: string,
    playerName: string,
    walletAddress: string,
    entryFee: number,
    lobbyId: string,
    tier: string
  ): Promise<RefundResult> {
    try {
      const separator = '══════════════════════════════════════════════════════════════════════';
      console.log('\n' + separator);
      console.log(`💸 PROCESSING REFUND`);
      console.log(separator);
      console.log(`   Player: ${playerName}`);
      console.log(`   Amount: $${entryFee} USDC`);
      console.log(`   Wallet: ${walletAddress}`);

      // IDEMPOTENCY CHECK: Verify payment record exists and is not already refunded
      if (mongoose.connection.readyState === 1) {
        const { LobbyPayment } = await import('../models/LobbyPayment.js');
        const existingPayment = await (LobbyPayment as any).findOne({
          playerId,
          lobbyId,
          status: 'paid'
        });

        if (!existingPayment) {
          console.log(`⚠️ No active payment found for ${playerId} in ${lobbyId} - already refunded or never paid`);
          return {
            success: false,
            error: 'No active payment record found (already refunded or never paid)',
          };
        }

        console.log(`✅ Payment record found - proceeding with refund`);
      }

      // Check platform has enough balance
      const balance = await this.walletManager.getUSDCBalance();
      if (balance < entryFee) {
        const error = 'Insufficient platform balance for refund';
        console.error(`❌ ${error}`);
        return {
          success: false,
          error,
        };
      }

      // Check if player has USDC account, create if needed
      try {
        const hasATA = await this.walletManager.hasUSDCAccount(walletAddress);
        if (!hasATA) {
          console.log(`📝 Creating USDC account for refund...`);
          await this.walletManager.createUSDCAccount(walletAddress);
        }
      } catch (error: any) {
        console.error(`❌ Failed to check/create USDC account:`, error);
        return {
          success: false,
          error: `Failed to prepare refund: ${error.message}`,
        };
      }

      // Send refund
      const signature = await this.walletManager.transferUSDC(
        walletAddress,
        entryFee,
        lobbyId,
        `${tier}_REFUND`
      );

      console.log(`\n   ✅ REFUND COMPLETE`);
      console.log(`   TX Signature: ${signature}`);
      console.log(`   View: https://solscan.io/tx/${signature}`);
      console.log(separator + '\n');

      // DELETE payment record from database (refunded = not in pot)
      if (mongoose.connection.readyState === 1) {
        const { LobbyPayment } = await import('../models/LobbyPayment.js');
        const deleteResult = await (LobbyPayment as any).deleteOne({
          playerId,
          lobbyId,
          status: 'paid'
        });

        if (deleteResult.deletedCount > 0) {
          console.log(`📝 Payment record deleted: ${playerId} refunded (removed from pot)`);
        } else {
          console.warn(`⚠️ No payment record found to delete for ${playerId} in ${lobbyId}`);
        }
      }

      return {
        success: true,
        txSignature: signature,
      };
    } catch (error: any) {
      console.error(`❌ Refund failed:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get total paid entry fees for a lobby (for pot calculation)
   */
  async getLobbyPot(lobbyId: string): Promise<number> {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.warn('⚠️ MongoDB not connected - cannot calculate pot');
        return 0;
      }

      const { LobbyPayment } = await import('../models/LobbyPayment.js');
      const payments = await (LobbyPayment as any).find({ 
        lobbyId, 
        status: 'paid' 
      });

      const totalPot = payments.reduce((sum, payment) => sum + payment.entryFee, 0);
      return totalPot;
    } catch (error) {
      console.error('❌ Error calculating lobby pot:', error);
      return 0;
    }
  }

  /**
   * Get count of paid players in lobby
   */
  async getPaidPlayerCount(lobbyId: string): Promise<number> {
    try {
      if (mongoose.connection.readyState !== 1) {
        return 0;
      }

      const { LobbyPayment } = await import('../models/LobbyPayment.js');
      const count = await LobbyPayment.countDocuments({ 
        lobbyId, 
        status: 'paid' 
      });

      return count;
    } catch (error) {
      console.error('❌ Error counting paid players:', error);
      return 0;
    }
  }

  /**
   * Clear paid entry fees for a lobby (called on lobby reset)
   */
  async clearLobbyPayments(lobbyId: string): Promise<void> {
    try {
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const { LobbyPayment } = await import('../models/LobbyPayment.js');
      
      // Mark all paid entries as used (so they don't count for next game)
      const result = await LobbyPayment.updateMany(
        { lobbyId, status: 'paid' },
        { status: 'used' as any }
      );

      if (result.modifiedCount > 0) {
        console.log(`🧹 Cleared ${result.modifiedCount} payment records for ${lobbyId}`);
      }
    } catch (error) {
      console.error('❌ Error clearing lobby payments:', error);
    }
  }
}

