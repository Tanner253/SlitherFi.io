import mongoose, { Schema, Document } from 'mongoose';

export interface IGame extends Document {
  gameId: string;
  tier: string;
  winnerId: string | null;
  winnerName: string | null;
  potAmount: number;
  playerCount: number;
  duration: number;
  timestamp: number;
  createdAt: Date;
}

const GameSchema = new Schema<IGame>({
  gameId: { type: String, required: true, unique: true, index: true },
  tier: { type: String, required: true, index: true },
  winnerId: { type: String, default: null },
  winnerName: { type: String, default: null },
  potAmount: { type: Number, required: true },
  playerCount: { type: Number, required: true },
  duration: { type: Number, required: true },
  timestamp: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Indexes
GameSchema.index({ timestamp: -1 });
GameSchema.index({ tier: 1, timestamp: -1 });

export const Game = mongoose.models.Game || mongoose.model<IGame>('Game', GameSchema);


