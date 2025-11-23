import mongoose from 'mongoose';
import { WalletManager } from './walletManager.js';

/**
 * Refund Service for Incomplete Games
 * Handles refunds when server restarts before games complete
 */

export async function refundIncompletPayments(walletManager: WalletManager): Promise<void> {
  try {
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║           🔄 CHECKING FOR INCOMPLETE PAYMENTS                        ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
    
    if (mongoose.connection.readyState !== 1) {
      console.log('⚠️  MongoDB not connected - skipping incomplete payment check\n');
      return;
    }

    const { LobbyPayment } = await import('../models/LobbyPayment.js');
    const { GameDistribution } = await import('../models/GameDistribution.js');
    
    // Find all paid entry fees
    const paidEntries = await (LobbyPayment as any).find({ status: 'paid' });
    
    if (paidEntries.length === 0) {
      console.log('✅ No incomplete payments found\n');
      return;
    }
    
    console.log(`📊 Found ${paidEntries.length} paid entry fees, checking for completions...`);
    
    let refunded = 0;
    let completed = 0;
    
    for (const entry of paidEntries) {
      // Check if game was completed (has distribution record)
      const distribution = await (GameDistribution as any).findOne({ gameId: entry.lobbyId });
      
      if (distribution) {
        // Game completed - entry fee was used
        completed++;
        continue;
      }
      
      // Game never completed - refund the player
      console.log(`\n💸 REFUNDING INCOMPLETE GAME:`);
      console.log(`   Player: ${entry.walletAddress.substring(0, 8)}...`);
      console.log(`   Amount: $${entry.entryFee}`);
      console.log(`   Lobby: ${entry.lobbyId} (Tier: ${entry.tier})`);
      console.log(`   Original TX: ${entry.txSignature}`);
      
      try {
        // Check if player has USDC account
        const hasATA = await walletManager.hasUSDCAccount(entry.walletAddress);
        if (!hasATA) {
          console.log(`   📝 Creating USDC account...`);
          await walletManager.createUSDCAccount(entry.walletAddress);
        }
        
        // Send refund
        const refundTx = await walletManager.transferUSDC(
          entry.walletAddress,
          entry.entryFee,
          entry.lobbyId,
          `${entry.tier}_STARTUP_REFUND`
        );
        
        // Update payment record
        await (LobbyPayment as any).findByIdAndUpdate(entry._id, {
          status: 'refunded',
          refundTx: refundTx
        });
        
        console.log(`   ✅ Refunded! TX: ${refundTx}`);
        console.log(`   View: https://solscan.io/tx/${refundTx}`);
        refunded++;
        
      } catch (error: any) {
        console.error(`   ❌ Refund failed: ${error.message}`);
        console.error(`   → Manual intervention required for ${entry.walletAddress}`);
      }
    }
    
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║           💸 INCOMPLETE PAYMENT CLEANUP COMPLETE                     ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Payments Checked: ${paidEntries.length.toString().padStart(47)} ║`);
    console.log(`║ Games Completed:        ${completed.toString().padStart(47)} ║`);
    console.log(`║ Refunds Issued:         ${refunded.toString().padStart(47)} ║`);
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
    
  } catch (error) {
    console.error('❌ Error checking incomplete payments:', error);
  }
}

