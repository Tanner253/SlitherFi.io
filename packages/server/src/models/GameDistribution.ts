import mongoose, { Schema, Document } from 'mongoose';

export interface IGameDistribution extends Document {
  gameId: string;
  tier: string;
  paidPlayers: number;
  totalPot: number;
  winnerPayout: number;
  winnerWallet: string;
  winnerTx: string;
  platformFee: number;
  burnAmount: number;
  burnWallet: string;
  burnTx: string;
  botWinner: boolean; // true if bot won and we paid highest human
  timestamp: number;
  createdAt: Date;
}

const GameDistributionSchema = new Schema<IGameDistribution>({
  gameId: { type: String, required: true, unique: true, index: true },
  tier: { type: String, required: true },
  paidPlayers: { type: Number, required: true },
  totalPot: { type: Number, required: true },
  winnerPayout: { type: Number, required: true },
  winnerWallet: { type: String, required: true },
  winnerTx: { type: String, required: true },
  platformFee: { type: Number, required: true },
  burnAmount: { type: Number, required: true },
  burnWallet: { type: String, required: true },
  burnTx: { type: String, required: true },
  botWinner: { type: Boolean, default: false },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Indexes
GameDistributionSchema.index({ timestamp: -1 });
GameDistributionSchema.index({ tier: 1, timestamp: -1 });

export const GameDistribution = mongoose.models.GameDistribution || mongoose.model<IGameDistribution>('GameDistribution', GameDistributionSchema);

