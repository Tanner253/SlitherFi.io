import mongoose from 'mongoose';

const authSessionSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    index: true,
  },
  sessionToken: {
    type: String,
    required: true,
    unique: true,
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true, // For cleanup queries
  },
  lastUsed: {
    type: Date,
    required: true,
    default: Date.now,
  },
  gamesPlayed: {
    type: Number,
    default: 0,
  },
  ipAddress: {
    type: String,
    required: false,
  },
});

// Auto-delete expired sessions
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSession = mongoose.model('AuthSession', authSessionSchema);

