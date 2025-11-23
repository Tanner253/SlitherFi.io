/**
 * x403 Authentication Types
 * 
 * Wallet signature-based authentication for SlitherFi
 */

export const X403_VERSION = 1;

/**
 * Authentication Challenge (sent in 403 response)
 */
export interface AuthChallenge {
  x403Version: number;
  domain: string; // slitherfi.io or localhost
  nonce: string; // Random 32-byte hex
  issuedAt: number; // Unix timestamp
  expiresAt: number; // Unix timestamp (60 seconds from issue)
  message: string; // Full message to sign
}

/**
 * 403 Forbidden Response
 */
export interface AuthRequiredResponse {
  x403Version: number;
  challenge: AuthChallenge;
  reason: string;
}

/**
 * Signed Challenge (sent in Authorization header)
 */
export interface SignedChallenge {
  x403Version: number;
  walletAddress: string;
  signature: string; // Base58 encoded signature
  nonce: string; // Must match challenge nonce
}

/**
 * Auth Session (stored in MongoDB)
 */
export interface AuthSession {
  walletAddress: string;
  sessionToken: string; // JWT token
  createdAt: Date;
  expiresAt: Date;
  lastUsed: Date;
  gamesPlayed: number;
  ipAddress?: string;
}

/**
 * Rate Limit Record (in-memory only)
 */
export interface RateLimitRecord {
  walletAddress: string;
  failureCount: number;
  lastFailure: number;
  unlockAt: number; // Timestamp when they can try again
}

