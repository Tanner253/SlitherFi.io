import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  walletAddress: string;
  username: string;
  totalWinnings: number;
  totalWagered: number;
  gamesWon: number;
  gamesPlayed: number;
  lastActive: Date;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  walletAddress: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  totalWinnings: { type: Number, default: 0 },
  totalWagered: { type: Number, default: 0 },
  gamesWon: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for leaderboard queries
UserSchema.index({ totalWinnings: -1 });
UserSchema.index({ gamesWon: -1 });
UserSchema.index({ totalWagered: -1 });

export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);



