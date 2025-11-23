'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Singleton flag to prevent duplicate logs
let walletProviderInitialized = false;

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  // Get RPC endpoint from environment or use default
  const endpoint = useMemo(() => {
    const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
    
    // Only log once and only on client-side
    if (typeof window !== 'undefined' && !walletProviderInitialized) {
      walletProviderInitialized = true;
      console.log('🔗 Wallet provider initialized');
    }
    
    return rpc;
  }, []);

  // Support Phantom and Solflare wallets (both have mobile support)
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
