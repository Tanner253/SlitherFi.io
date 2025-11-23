/**
 * x402 Protocol Utilities
 * 
 * Helper functions for creating payment requests and verifying payments
 */

import type {
  PaymentRequiredResponse,
  PaymentRequirements,
  PaymentPayload,
  PaymentResponse,
} from '../types/x402.js';
import { X402_VERSION, X_PAYMENT_HEADER, X_PAYMENT_RESPONSE_HEADER } from '../types/x402.js';

/**
 * Create a 402 Payment Required response
 */
export function createPaymentRequired(
  tier: string,
  entryFee: number,
  platformWallet: string,
  usdcMint: string
): PaymentRequiredResponse {
  // Convert USDC to smallest unit (6 decimals)
  const amountInLamports = Math.floor(entryFee * 1_000_000).toString();

  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'solana-mainnet',
    maxAmountRequired: amountInLamports,
    resource: '/api/join-lobby',
    description: `SlitherFi $${entryFee} Entry Fee`,
    mimeType: 'application/json',
    payTo: platformWallet,
    maxTimeoutSeconds: 120,
    asset: usdcMint,
    extra: {
      tier,
      gameMode: `$${entryFee} USDC`,
    },
  };

  return {
    x402Version: X402_VERSION,
    accepts: [requirements],
  };
}

/**
 * Encode payment payload to Base64 JSON (for X-PAYMENT header)
 */
export function encodePaymentPayload(payload: PaymentPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Decode payment payload from Base64 JSON
 */
export function decodePaymentPayload(encoded: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as PaymentPayload;
  } catch (error) {
    console.error('❌ Failed to decode payment payload:', error);
    return null;
  }
}

/**
 * Encode payment response to Base64 JSON (for X-PAYMENT-RESPONSE header)
 */
export function encodePaymentResponse(response: PaymentResponse): string {
  const json = JSON.stringify(response);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Extract payment header from request
 */
export function extractPaymentHeader(req: any): string | null {
  return req.headers[X_PAYMENT_HEADER] || req.headers[X_PAYMENT_HEADER.toLowerCase()] || null;
}

/**
 * Create payment response headers
 */
export function createPaymentResponseHeaders(
  response: PaymentResponse
): Record<string, string> {
  return {
    [X_PAYMENT_RESPONSE_HEADER]: encodePaymentResponse(response),
  };
}

/**
 * Validate payment payload structure
 */
export function validatePaymentPayload(payload: any): payload is PaymentPayload {
  return (
    payload &&
    typeof payload.x402Version === 'number' &&
    typeof payload.scheme === 'string' &&
    typeof payload.network === 'string' &&
    payload.payload &&
    typeof payload.payload === 'object' &&
    typeof payload.payload.signature === 'string' &&
    typeof payload.payload.from === 'string' &&
    typeof payload.payload.to === 'string' &&
    typeof payload.payload.amount === 'string' &&
    typeof payload.payload.mint === 'string'
  );
}

