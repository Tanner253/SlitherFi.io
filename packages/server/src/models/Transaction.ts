import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
  id: string;
  gameId: string;
  tier: string;
  winnerId: string;
  winnerName: string;
  walletAddress: string;
  amountUSDC: number;
  txSignature: string | null;
  status: 'pending' | 'success' | 'failed';
  timestamp: number;
  createdAt: Date;
}

const TransactionSchema = new Schema<ITransaction>({
  id: { type: String, required: true, unique: true },
  gameId: { type: String, required: true, index: true },
  tier: { type: String, required: true, index: true },
  winnerId: { type: String, required: true },
  winnerName: { type: String, required: true },
  walletAddress: { type: String, required: true, index: true },
  amountUSDC: { type: Number, required: true },
  txSignature: { type: String, default: null },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for fast queries
TransactionSchema.index({ timestamp: -1 });
TransactionSchema.index({ status: 1, timestamp: -1 });

export const Transaction = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);


