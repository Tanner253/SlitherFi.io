import mongoose from 'mongoose';

export interface Transaction {
  id: string;
  timestamp: number;
  winnerId: string;
  winnerName: string;
  walletAddress: string;
  amountUSDC: number;
  txSignature: string | null;
  gameId: string;
  tier: string;
  playersCount: number;
  status: 'success' | 'failed' | 'pending';
  retries: number;
  error?: string;
}

/**
 * Log a new transaction to MongoDB
 */
export async function logTransaction(transaction: Transaction): Promise<void> {
  try {
    // Check if DB is connected
    if (mongoose.connection.readyState !== 1) {
      console.warn('⚠️ MongoDB not connected - transaction not saved to DB');
      return;
    }

    const { Transaction } = await import('../models/Transaction.js');
    
    await (Transaction as any).create({
      id: transaction.id,
      gameId: transaction.gameId,
      tier: transaction.tier,
      winnerId: transaction.winnerId,
      winnerName: transaction.winnerName,
      walletAddress: transaction.walletAddress,
      amountUSDC: transaction.amountUSDC,
      txSignature: transaction.txSignature,
      status: transaction.status,
      timestamp: transaction.timestamp,
    });
    
    console.log(`📝 Transaction logged to DB: ${transaction.id} - ${transaction.status}`);
  } catch (error) {
    console.error('❌ Error logging transaction to DB:', error);
  }
}

/**
 * Update transaction status in MongoDB
 */
export async function updateTransaction(txId: string, updates: Partial<Transaction>): Promise<void> {
  try {
    // Check if DB is connected
    if (mongoose.connection.readyState !== 1) {
      console.warn('⚠️ MongoDB not connected - transaction update not saved');
      return;
    }

    const { Transaction } = await import('../models/Transaction.js');
    
    const updateData: any = {};
    if (updates.status) updateData.status = updates.status;
    if (updates.txSignature) updateData.txSignature = updates.txSignature;
    if (updates.error) updateData.error = updates.error;
    
    await (Transaction as any).findOneAndUpdate(
      { id: txId },
      updateData,
      { new: true }
    );
    
    console.log(`📝 Transaction updated in DB: ${txId}`);
  } catch (error) {
    console.error('❌ Error updating transaction in DB:', error);
  }
}

/**
 * Get all transactions from MongoDB
 */
export async function getAllTransactions(): Promise<Transaction[]> {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.warn('⚠️ MongoDB not connected - cannot fetch transactions');
      return [];
    }

    const { Transaction } = await import('../models/Transaction.js');
    const transactions = await (Transaction as any).find().sort({ timestamp: -1 }).lean();
    
    return transactions.map(tx => ({
      id: tx.id,
      timestamp: tx.timestamp,
      winnerId: tx.winnerId,
      winnerName: tx.winnerName,
      walletAddress: tx.walletAddress,
      amountUSDC: tx.amountUSDC,
      txSignature: tx.txSignature,
      gameId: tx.gameId,
      tier: tx.tier,
      playersCount: 0, // Not stored in new schema
      status: tx.status as 'success' | 'failed' | 'pending',
      retries: 0, // Not stored in new schema
      error: undefined,
    }));
  } catch (error) {
    console.error('❌ Error fetching transactions from DB:', error);
    return [];
  }
}

/**
 * Get recent transactions (limit) from MongoDB
 */
export async function getRecentTransactions(limit: number = 50): Promise<Transaction[]> {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.warn('⚠️ MongoDB not connected - cannot fetch transactions');
      return [];
    }

    const { Transaction } = await import('../models/Transaction.js');
    const transactions = await (Transaction as any).find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    return transactions.map(tx => ({
      id: tx.id,
      timestamp: tx.timestamp,
      winnerId: tx.winnerId,
      winnerName: tx.winnerName,
      walletAddress: tx.walletAddress,
      amountUSDC: tx.amountUSDC,
      txSignature: tx.txSignature,
      gameId: tx.gameId,
      tier: tx.tier,
      playersCount: 0,
      status: tx.status as 'success' | 'failed' | 'pending',
      retries: 0,
      error: undefined,
    }));
  } catch (error) {
    console.error('❌ Error fetching recent transactions from DB:', error);
    return [];
  }
}

/**
 * Get transactions by wallet address from MongoDB
 */
export async function getTransactionsByWallet(walletAddress: string): Promise<Transaction[]> {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.warn('⚠️ MongoDB not connected - cannot fetch transactions');
      return [];
    }

    const { Transaction } = await import('../models/Transaction.js');
    const transactions = await (Transaction as any).find({ walletAddress })
      .sort({ timestamp: -1 })
      .lean();
    
    return transactions.map(tx => ({
      id: tx.id,
      timestamp: tx.timestamp,
      winnerId: tx.winnerId,
      winnerName: tx.winnerName,
      walletAddress: tx.walletAddress,
      amountUSDC: tx.amountUSDC,
      txSignature: tx.txSignature,
      gameId: tx.gameId,
      tier: tx.tier,
      playersCount: 0,
      status: tx.status as 'success' | 'failed' | 'pending',
      retries: 0,
      error: undefined,
    }));
  } catch (error) {
    console.error('❌ Error fetching transactions by wallet from DB:', error);
    return [];
  }
}
