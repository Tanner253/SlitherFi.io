import mongoose, { Schema, Document } from 'mongoose';

export interface IGameSession extends Document {
  gameId: string;
  lobbyId: string;
  tier: string;
  startTime: number;
  endTime?: number;
  status: 'active' | 'completed' | 'cancelled';
  totalPlayers: number;
  humanPlayers: number;
  botPlayers: number;
  winnerId?: string;
  winnerName?: string;
  duration?: number;
  createdAt: Date;
}

const GameSessionSchema = new Schema<IGameSession>({
  gameId: { type: String, required: true, unique: true, index: true },
  lobbyId: { type: String, required: true, index: true },
  tier: { type: String, required: true, index: true },
  startTime: { type: Number, required: true },
  endTime: { type: Number },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
  totalPlayers: { type: Number, required: true },
  humanPlayers: { type: Number, required: true },
  botPlayers: { type: Number, required: true },
  winnerId: { type: String },
  winnerName: { type: String },
  duration: { type: Number },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for queries
GameSessionSchema.index({ lobbyId: 1, status: 1 });
GameSessionSchema.index({ tier: 1, startTime: -1 });
GameSessionSchema.index({ status: 1, startTime: -1 });

export const GameSession = mongoose.models.GameSession || mongoose.model<IGameSession>('GameSession', GameSessionSchema);


