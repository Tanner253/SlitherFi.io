/**
 * Token Gating Utilities for SlitherFi
 * 
 * Check $SLITH token balance for gameplay access
 */

import { Connection, PublicKey } from '@solana/web3.js';

const AGARFI_MINT_ADDRESS = '6WQxQRguwYVwrHpFkNJsLK2XRnWLuqaLuQ8VBGXupump';
const MIN_AGARFI_BALANCE = 100000; // Minimum tokens required to play

interface TokenAccountInfo {
  account: {
    data: {
      parsed: {
        info: {
          tokenAmount: {
            uiAmount: number | null;
          };
        };
      };
    };
  };
}

interface TokenBalanceResult {
  total: number;
  meetsRequirement: boolean;
  required: number;
}

/**
 * Check if wallet meets token gating requirements
 */
export async function checkAgarFiTokenBalance(
  walletAddress: string,
  rpcUrl: string
): Promise<TokenBalanceResult> {
  try {
    console.log(`🐍 Checking $SLITH token balance...`);
    console.log(`   Wallet: ${walletAddress.slice(0, 8)}...`);
    console.log(`   Required: ${MIN_AGARFI_BALANCE.toLocaleString()} $SLITH`);
    
    const connection = new Connection(rpcUrl, 'confirmed');
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(AGARFI_MINT_ADDRESS);

    // Get all token accounts for this wallet with SLITH mint
    const accounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { mint: mintPubkey }
    );

    // Sum balances across all accounts (in case multiple ATAs)
    const total = (accounts.value as unknown as TokenAccountInfo[]).reduce((sum, account) => {
      const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
      return sum + (balance || 0);
    }, 0);

    const meetsRequirement = total >= MIN_AGARFI_BALANCE;

    console.log(`   Balance: ${total.toLocaleString()} $SLITH`);
    console.log(`   Status: ${meetsRequirement ? '✅ PASS' : '❌ INSUFFICIENT'}`);

    return {
      total,
      meetsRequirement,
      required: MIN_AGARFI_BALANCE,
    };
  } catch (error: any) {
    console.error('❌ Failed to check $SLITH balance:', error.message || error);
    
    // Return failure result
    return {
      total: 0,
      meetsRequirement: false,
      required: MIN_AGARFI_BALANCE,
    };
  }
}

