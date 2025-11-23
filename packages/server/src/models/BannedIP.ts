import mongoose, { Schema, Document } from 'mongoose';

export interface IBannedIP extends Document {
  ip: string;
  playerName: string;
  playerId: string;
  reason: string;
  timestamp: number;
  createdAt: Date;
}

const BannedIPSchema = new Schema<IBannedIP>({
  ip: { type: String, required: true, unique: true, index: true },
  playerName: { type: String, required: true },
  playerId: { type: String, required: true },
  reason: { type: String, required: true },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Index for fast IP lookups
BannedIPSchema.index({ ip: 1 });

export const BannedIP = mongoose.models.BannedIP || mongoose.model<IBannedIP>('BannedIP', BannedIPSchema);


