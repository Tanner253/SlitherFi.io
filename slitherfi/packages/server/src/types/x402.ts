/**
 * x402 Payment Protocol Types
 * Based on: https://github.com/coinbase/x402
 */

export const X402_VERSION = 1;
export const X_PAYMENT_HEADER = 'x-payment';
export const X_PAYMENT_RESPONSE_HEADER = 'x-payment-response';

/**
 * Payment Requirements (returned in 402 response)
 */
export interface PaymentRequirements {
  scheme: 'exact' | 'minimum';
  network: string; // e.g., 'solana-mainnet'
  maxAmountRequired: string; // Amount in smallest unit (lamports for USDC)
  resource: string; // API endpoint being accessed
  description?: string; // Human-readable description
  mimeType?: string; // Response content type
  payTo: string; // Recipient wallet address
  maxTimeoutSeconds?: number; // Payment timeout
  asset: string; // Token mint address (USDC)
  extra?: Record<string, any>; // Additional metadata
}

/**
 * 402 Payment Required Response
 */
export interface PaymentRequiredResponse {
  x402Version: number;
  accepts: PaymentRequirements[];
}

/**
 * Payment Payload (sent in X-PAYMENT header)
 */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string; // Solana transaction signature
    from: string; // Payer wallet address
    to: string; // Recipient wallet address
    amount: string; // Amount in smallest unit
    mint: string; // Token mint address
  };
}

/**
 * Payment Response (server sends back)
 */
export interface PaymentResponse {
  success: boolean;
  verified: boolean;
  txSignature?: string;
  lobbyToken?: string; // JWT token for lobby access
  error?: string;
}

/**
 * Lobby Access Token (JWT payload)
 */
export interface LobbyAccessToken {
  playerId: string;
  playerName: string;
  tier: string;
  walletAddress: string | null;
  txSignature: string;
  free: boolean;
  iat?: number; // Issued at (added by JWT library)
  exp?: number; // Expires at (added by JWT library)
}

