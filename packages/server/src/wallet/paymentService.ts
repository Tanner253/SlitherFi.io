import { WalletManager } from './walletManager.js';
import { logTransaction, updateTransaction, Transaction } from './transactionLogger.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries

export interface PayoutResult {
  success: boolean;
  txSignature: string | null;
  error?: string;
  retries: number;
}

/**
 * Payment Service - Handles winner payouts with retry logic
 */
export class PaymentService {
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
  }

  /**
   * Sleep helper for retries
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update user stats after successful payout (for leaderboard)
   */
  private async updateUserStats(walletAddress: string, username: string, amount: number): Promise<void> {
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        console.warn('⚠️ MongoDB not connected - user stats not updated');
        return;
      }

      const { User } = await import('../models/User.js');
      
      await (User as any).findOneAndUpdate(
        { walletAddress },
        { 
          $inc: { totalWinnings: amount, gamesWon: 1 },
          $set: { username, lastActive: new Date() }
        },
        { upsert: true }
      );
      
      console.log(`📊 User stats updated: ${username} (+$${amount} USDC, +1 win)`);
    } catch (error) {
      console.error('❌ Error updating user stats:', error);
    }
  }

  /**
   * Send payout to winner with 3-retry logic
   */
  async sendWinnerPayout(
    winnerId: string,
    winnerName: string,
    walletAddress: string,
    gameId: string,
    tier: string,
    playersCount: number,
    amount: number
  ): Promise<PayoutResult> {
    const txId = `tx_${Date.now()}`;

    console.log(`💰 Processing Dream Mode payout for ${winnerName} (${walletAddress})`);
    console.log(`   Amount: $${amount} USDC`);

    // Check if platform has sufficient funds
    const hasFunds = await this.walletManager.hasSufficientFunds(amount);
    if (!hasFunds) {
      const error = 'Insufficient platform funds';
      console.error(`❌ ${error}`);
      
      // Log failed transaction
      await logTransaction({
        id: txId,
        timestamp: Date.now(),
        winnerId,
        winnerName,
        walletAddress,
        amountUSDC: amount,
        txSignature: null,
        gameId,
        tier,
        playersCount,
        status: 'failed',
        retries: 0,
        error,
      });

      return {
        success: false,
        txSignature: null,
        error,
        retries: 0,
      };
    }

    // Log initial transaction
    await logTransaction({
      id: txId,
      timestamp: Date.now(),
      winnerId,
      winnerName,
      walletAddress,
      amountUSDC: amount,
      txSignature: null,
      gameId,
      tier,
      playersCount,
      status: 'pending',
      retries: 0,
    });

    // Check if winner has USDC ATA, create if not
    try {
      const hasATA = await this.walletManager.hasUSDCAccount(walletAddress);
      
      if (!hasATA) {
        console.log(`📝 Winner doesn't have USDC account, creating...`);
        await this.walletManager.createUSDCAccount(walletAddress);
        console.log(`✅ USDC account created for ${walletAddress}`);
      }
    } catch (error: any) {
      const errorMsg = `Failed to create USDC account: ${error.message}`;
      console.error(`❌ ${errorMsg}`);
      
      await updateTransaction(txId, {
        status: 'failed',
        error: errorMsg,
      });

      return {
        success: false,
        txSignature: null,
        error: errorMsg,
        retries: 0,
      };
    }

    // Attempt transfer with retries
    let lastError: string = '';
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 Transfer attempt ${attempt + 1}/${MAX_RETRIES}...`);

        const signature = await this.walletManager.transferUSDC(walletAddress, amount, gameId, tier);

        // Success!
        console.log(`✅ Payout successful: ${signature}`);
        
        // Update transaction in DB
        await updateTransaction(txId, {
          txSignature: signature,
          status: 'success',
          retries: attempt,
        });

        console.log(`📝 Transaction logged: ${txId}`);

        // Update user stats (totalWinnings, gamesWon) for leaderboard
        await this.updateUserStats(walletAddress, winnerName, amount);

        return {
          success: true,
          txSignature: signature,
          retries: attempt,
        };
      } catch (error: any) {
        lastError = error.message;
        console.error(`❌ Transfer attempt ${attempt + 1} failed:`, lastError);

        // Wait before retry (except on last attempt)
        if (attempt < MAX_RETRIES - 1) {
          console.log(`⏳ Retrying in ${RETRY_DELAY_MS}ms...`);
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }

    // All retries failed
    console.error(`❌ All ${MAX_RETRIES} attempts failed for ${winnerName}`);
    
    await updateTransaction(txId, {
      status: 'failed',
      error: lastError,
      retries: MAX_RETRIES,
    });

    return {
      success: false,
      txSignature: null,
      error: lastError,
      retries: MAX_RETRIES,
    };
  }

  /**
   * Check if platform can pay Dream Mode winners (minimum $1)
   */
  async canPayWinners(): Promise<boolean> {
    const balance = await this.walletManager.getUSDCBalance();
    return balance >= 1; // At least $1 for Dream Mode payouts
  }

  /**
   * Get current platform USDC balance
   */
  async getPlatformBalance(): Promise<number> {
    return await this.walletManager.getUSDCBalance();
  }
}

