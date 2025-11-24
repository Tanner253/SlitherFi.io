/**
 * x403 Client Utilities
 * 
 * Wallet signature-based authentication for SnekFi
 */

import bs58 from 'bs58';

export const X403_VERSION = 1;

export interface AuthChallenge {
  x403Version: number;
  domain: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  message: string;
}

export interface AuthRequiredResponse {
  x403Version: number;
  challenge: AuthChallenge;
  reason: string;
}

export interface SignedChallenge {
  x403Version: number;
  walletAddress: string;
  signature: string;
  nonce: string;
}

/**
 * Sign authentication challenge with wallet
 */
export async function signChallenge(
  challenge: AuthChallenge,
  wallet: any // Solana wallet adapter
): Promise<{ success: boolean; signedChallenge?: SignedChallenge; error?: string }> {
  try {
    if (!wallet.signMessage) {
      return { 
        success: false, 
        error: 'Wallet does not support message signing' 
      };
    }

    console.log('✍️  x403: Signing authentication challenge...');
    
    // Convert message to Uint8Array
    const messageBytes = new TextEncoder().encode(challenge.message);

    // Sign message (NOT a transaction - costs $0)
    const signatureBytes = await wallet.signMessage(messageBytes);

    // Convert signature to base58
    const signature = bs58.encode(signatureBytes);

    console.log('✅ x403: Challenge signed successfully');

    const signedChallenge: SignedChallenge = {
      x403Version: X403_VERSION,
      walletAddress: wallet.publicKey.toBase58(),
      signature,
      nonce: challenge.nonce,
    };

    return { success: true, signedChallenge };
  } catch (error: any) {
    console.error('❌ x403: Signing failed:', error);
    
    if (error.message?.includes('User rejected') || error.name === 'WalletSignMessageError') {
      return { success: false, error: 'Signature cancelled by user' };
    }
    
    return { success: false, error: error.message || 'Signing failed' };
  }
}

/**
 * Encode signed challenge to Authorization header
 */
export function encodeAuthHeader(signedChallenge: SignedChallenge): string {
  const json = JSON.stringify(signedChallenge);
  const encoded = btoa(json); // Browser-safe base64
  return `Bearer ${encoded}`;
}

