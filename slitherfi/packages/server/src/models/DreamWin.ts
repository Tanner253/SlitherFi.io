import mongoose, { Schema, Document } from 'mongoose';

export interface IDreamWin extends Document {
  ip: string;
  playerId: string;
  playerName: string;
  walletAddress: string;
  gameId: string;
  amountUSDC: number;
  txSignature: string | null;
  timestamp: number;
  createdAt: Date;
}

const DreamWinSchema = new Schema<IDreamWin>({
  ip: { type: String, required: true, index: true },
  playerId: { type: String, required: true },
  playerName: { type: String, required: true },
  walletAddress: { type: String, required: true },
  gameId: { type: String, required: true },
  amountUSDC: { type: Number, required: true },
  txSignature: { type: String, default: null },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // Auto-delete after 24 hours
});

// Indexes
DreamWinSchema.index({ ip: 1, timestamp: 1 });

export const DreamWin = mongoose.models.DreamWin || mongoose.model<IDreamWin>('DreamWin', DreamWinSchema);

