/**
 * x402 Client Utilities
 * 
 * Helper functions for x402 payment protocol on client side
 */

export const X402_VERSION = 1;

export interface PaymentRequirements {
  scheme: 'exact' | 'minimum';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  mimeType?: string;
  extra?: Record<string, any>;
}

export interface PaymentRequiredResponse {
  x402Version: number;
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    from: string;
    to: string;
    amount: string;
    mint: string;
  };
}

/**
 * Encode payment payload to Base64 JSON for X-PAYMENT header
 */
export function encodePaymentPayload(payload: PaymentPayload): string {
  const json = JSON.stringify(payload);
  // Browser-compatible base64 encoding
  return btoa(json);
}

/**
 * Create payment payload from transaction details
 */
export function createPaymentPayload(
  txSignature: string,
  fromWallet: string,
  toWallet: string,
  amount: number,
  mint: string
): PaymentPayload {
  // Convert USDC to lamports
  const amountLamports = Math.floor(amount * 1_000_000).toString();

  return {
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: 'solana-mainnet',
    payload: {
      signature: txSignature,
      from: fromWallet,
      to: toWallet,
      amount: amountLamports,
      mint,
    },
  };
}

