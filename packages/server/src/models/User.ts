import mongoose, { Schema, Document } from 'mongoose';

export interface EquippedCosmetics {
  trail?: string;
  headItem?: string;
  nameStyle?: string;
}

export interface IUser extends Document {
  walletAddress: string;
  username: string;
  totalWinnings: number;
  totalWagered: number;
  gamesWon: number;
  gamesPlayed: number;
  lastActive: Date;
  createdAt: Date;
  apples: number;
  unlockedCosmetics: string[];
  equippedCosmetics: EquippedCosmetics;
}

const UserSchema = new Schema<IUser>({
  walletAddress: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  totalWinnings: { type: Number, default: 0 },
  totalWagered: { type: Number, default: 0 },
  gamesWon: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  apples: { type: Number, default: 0, min: 0 },
  unlockedCosmetics: { type: [String], default: [] },
  equippedCosmetics: {
    type: {
      trail: { type: String, required: false },
      headItem: { type: String, required: false },
      nameStyle: { type: String, required: false }
    },
    default: {}
  }
});

// Indexes for leaderboard queries
UserSchema.index({ totalWinnings: -1 });
UserSchema.index({ gamesWon: -1 });
UserSchema.index({ totalWagered: -1 });
UserSchema.index({ apples: -1 }); // For apple leaderboard in future

export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);



