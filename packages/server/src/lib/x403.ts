/**
 * x403 Authentication Protocol
 * 
 * Wallet signature-based authentication for SlitherFi
 * Based on: https://github.com/ByrgerBib/webx403
 */

import { randomBytes } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import jwt from 'jsonwebtoken';
import type { AuthChallenge, AuthRequiredResponse, SignedChallenge, RateLimitRecord } from '../types/x403.js';

// In-memory storage (cleared on restart as requested)
const activeChallenges = new Map<string, AuthChallenge>(); // nonce -> challenge
const rateLimits = new Map<string, RateLimitRecord>(); // wallet -> rate limit
const usedNonces = new Set<string>(); // Prevent replay attacks

// Rate limit tiers (progressive punishment)
const RATE_LIMIT_TIERS = [
  60 * 1000,        // 1st failure: 60 seconds
  5 * 60 * 1000,    // 2nd failure: 5 minutes
  30 * 60 * 1000,   // 3rd failure: 30 minutes
  60 * 60 * 1000,   // 4th failure: 1 hour
  24 * 60 * 60 * 1000, // 5th+ failure: 24 hours
];

/**
 * Generate authentication challenge
 */
export function generateChallenge(domain: string): AuthChallenge {
  const nonce = randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (180 * 1000); // 3 minutes (time to read modal)

  const message = `🐍 SlitherFi Wallet Verification

This signature proves you own this wallet.

WHY THIS IS SAFE:
• This is NOT a transaction (costs $0)
• We're just verifying wallet ownership
• No funds can be moved with this signature
• This helps prevent bots and keep games fair

⚠️ SECURITY: Always verify you're on the correct domain
✓ Correct domain: ${domain}
✗ Never sign on unfamiliar domains!

HOW x403 PROTECTS YOU:
• One wallet = one active game (stops multi-accounting)
• Tracks your game history and stats
• Prevents bot farming
• Ensures fair matchmaking

By signing, you authorize SlitherFi to:
• Create an authentication session for your wallet
• Track your game statistics and winnings
• Enforce fair-play rules

Technical Details:
Domain: ${domain}
Nonce: ${nonce}
Issued: ${new Date(issuedAt).toISOString()}
Expires: 3 minutes

x403 Protocol - Learn more: https://github.com/ByrgerBib/webx403`;

  const challenge: AuthChallenge = {
    x403Version: 1,
    domain,
    nonce,
    issuedAt,
    expiresAt,
    message,
  };

  // Store challenge (will be cleaned up after verification or expiry)
  activeChallenges.set(nonce, challenge);

  // Clean up expired challenges
  setTimeout(() => {
    activeChallenges.delete(nonce);
  }, 185 * 1000); // 185 seconds (5 second buffer)

  return challenge;
}

/**
 * Create 403 Forbidden response
 */
export function createAuthRequired(domain: string): AuthRequiredResponse {
  const challenge = generateChallenge(domain);

  return {
    x403Version: 1,
    challenge,
    reason: 'Wallet authentication required. Please sign with your wallet to verify ownership.',
  };
}

/**
 * Verify signed challenge
 */
export function verifySignature(
  signedChallenge: SignedChallenge
): { valid: boolean; error?: string } {
  try {
    const { walletAddress, signature, nonce } = signedChallenge;

    // Check if nonce was already used (replay attack)
    if (usedNonces.has(nonce)) {
      return { valid: false, error: 'Challenge already used (replay attack detected)' };
    }

    // Get original challenge
    const challenge = activeChallenges.get(nonce);
    if (!challenge) {
      return { valid: false, error: 'Challenge not found or expired' };
    }

    // Check expiry
    if (Date.now() > challenge.expiresAt) {
      activeChallenges.delete(nonce);
      return { valid: false, error: 'Challenge expired. Please try again.' };
    }

    // Verify signature using ed25519 (Solana's signature algorithm)
    const publicKey = new PublicKey(walletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(challenge.message);

    const verified = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!verified) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Mark nonce as used (prevent replay)
    usedNonces.add(nonce);

    // Clean up challenge
    activeChallenges.delete(nonce);

    // Clean up used nonce after 10 minutes (memory management)
    setTimeout(() => {
      usedNonces.delete(nonce);
    }, 10 * 60 * 1000);

    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message || 'Verification error' };
  }
}

/**
 * Check if wallet is rate limited
 */
export function isRateLimited(walletAddress: string): { limited: boolean; unlockAt?: number; reason?: string } {
  const record = rateLimits.get(walletAddress);
  
  if (!record) {
    return { limited: false };
  }

  const now = Date.now();

  if (now < record.unlockAt) {
    const remainingMs = record.unlockAt - now;
    const remainingMin = Math.ceil(remainingMs / 1000 / 60);
    
    return { 
      limited: true, 
      unlockAt: record.unlockAt,
      reason: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin !== 1 ? 's' : ''}.`
    };
  }

  // Unlock time passed, remove record
  rateLimits.delete(walletAddress);
  return { limited: false };
}

/**
 * Record authentication failure (progressive rate limiting)
 * Only enforces rate limit after 5 failures
 */
export function recordAuthFailure(walletAddress: string): void {
  const now = Date.now();
  const existing = rateLimits.get(walletAddress);
  const FREE_ATTEMPTS = 5; // Allow 5 failures before rate limiting

  if (existing) {
    // Increment failure count
    existing.failureCount++;
    existing.lastFailure = now;

    // Only apply rate limiting after FREE_ATTEMPTS
    if (existing.failureCount > FREE_ATTEMPTS) {
      const tierIndex = Math.min(existing.failureCount - FREE_ATTEMPTS - 1, RATE_LIMIT_TIERS.length - 1);
      existing.unlockAt = now + RATE_LIMIT_TIERS[tierIndex];

      console.log(`⚠️ x403: Auth failure #${existing.failureCount} for ${walletAddress.slice(0, 8)}...`);
      console.log(`   Locked for ${RATE_LIMIT_TIERS[tierIndex] / 1000 / 60} minutes`);
    } else {
      existing.unlockAt = now; // No lock yet
      console.log(`⚠️ x403: Auth failure #${existing.failureCount} for ${walletAddress.slice(0, 8)}... (${FREE_ATTEMPTS - existing.failureCount} attempts remaining)`);
    }
  } else {
    // First failure - no lock
    rateLimits.set(walletAddress, {
      walletAddress,
      failureCount: 1,
      lastFailure: now,
      unlockAt: now, // Not locked yet
    });

    console.log(`⚠️ x403: First auth failure for ${walletAddress.slice(0, 8)}... (${FREE_ATTEMPTS - 1} attempts remaining)`);
  }
}

/**
 * Clear rate limit for wallet (on successful auth)
 */
export function clearRateLimit(walletAddress: string): void {
  rateLimits.delete(walletAddress);
}

/**
 * Create authentication session token
 */
export function createSessionToken(
  walletAddress: string,
  jwtSecret: string
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + (30 * 60 * 1000)); // 30 minutes

  const token = jwt.sign(
    {
      walletAddress,
      type: 'x403-session',
      iat: Math.floor(Date.now() / 1000),
    },
    jwtSecret,
    { expiresIn: '30m' }
  );

  return { token, expiresAt };
}

/**
 * Verify session token
 */
export function verifySessionToken(
  token: string,
  jwtSecret: string
): { valid: boolean; walletAddress?: string; error?: string } {
  try {
    const decoded = jwt.verify(token, jwtSecret) as { walletAddress: string; type: string };

    if (decoded.type !== 'x403-session') {
      return { valid: false, error: 'Invalid token type' };
    }

    return { valid: true, walletAddress: decoded.walletAddress };
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Session expired. Please sign in again.' };
    }
    return { valid: false, error: 'Invalid session token' };
  }
}

/**
 * Decode Authorization header
 */
export function decodeAuthHeader(header: string): SignedChallenge | null {
  try {
    // Format: "Bearer base64(JSON)"
    if (!header.startsWith('Bearer ')) {
      return null;
    }

    const encoded = header.substring(7);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as SignedChallenge;
  } catch (error) {
    return null;
  }
}

/**
 * Get stats (for monitoring)
 */
export function getX403Stats() {
  return {
    activeChallenges: activeChallenges.size,
    usedNonces: usedNonces.size,
    rateLimitedWallets: rateLimits.size,
    rateLimitDetails: Array.from(rateLimits.values()).map(r => ({
      wallet: r.walletAddress.slice(0, 8) + '...',
      failures: r.failureCount,
      unlockAt: new Date(r.unlockAt).toISOString(),
    })),
  };
}

