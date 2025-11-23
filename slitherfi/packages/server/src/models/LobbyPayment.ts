import mongoose, { Schema, Document } from 'mongoose';

export interface ILobbyPayment extends Document {
  playerId: string;
  lobbyId: string;
  tier: string;
  walletAddress: string;
  entryFee: number;
  txSignature: string;
  status: 'paid' | 'refunded' | 'used';
  refundTx?: string;
  timestamp: number;
  createdAt: Date;
}

const LobbyPaymentSchema = new Schema<ILobbyPayment>({
  playerId: { type: String, required: true, index: true },
  lobbyId: { type: String, required: true, index: true },
  tier: { type: String, required: true },
  walletAddress: { type: String, required: true, index: true },
  entryFee: { type: Number, required: true },
  txSignature: { type: String, required: true, unique: true },
  status: { type: String, enum: ['paid', 'refunded', 'used'], default: 'paid' },
  refundTx: { type: String, default: null },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for fast queries
LobbyPaymentSchema.index({ lobbyId: 1, status: 1 });
LobbyPaymentSchema.index({ walletAddress: 1, timestamp: -1 });

export const LobbyPayment = mongoose.models.LobbyPayment || mongoose.model<ILobbyPayment>('LobbyPayment', LobbyPaymentSchema);

