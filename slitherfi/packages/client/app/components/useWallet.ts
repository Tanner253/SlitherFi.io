'use client';

import { useEffect, useState } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

/**
 * Custom hook that wraps Solana wallet adapter
 * Provides simplified interface for SlitherFi
 * Handles SSR gracefully
 */
export function useWallet() {
  const [mounted, setMounted] = useState(false);
  const solanaWallet = useSolanaWallet();
  const walletModal = useWalletModal();

  // Prevent SSR hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Log wallet connection state changes for debugging (only on client)
  useEffect(() => {
    if (!mounted || !solanaWallet.connecting) return;
    console.log('🔄 Wallet connecting...');
  }, [solanaWallet.connecting, mounted]);

  useEffect(() => {
    if (!mounted) return;
    
    if (solanaWallet.connected && solanaWallet.publicKey) {
      const address = solanaWallet.publicKey.toBase58();
      console.log('✅ Wallet connected successfully!');
      console.log(`   Wallet: ${address.slice(0, 8)}...${address.slice(-6)}`);
      console.log(`   Type: ${solanaWallet.wallet?.adapter.name || 'Unknown'}`);
    }
  }, [solanaWallet.connected, solanaWallet.publicKey, solanaWallet.wallet, mounted]);

  const handleConnect = () => {
    if (!mounted) return;
    console.log('🔘 Opening wallet modal...');
    walletModal.setVisible(true);
  };

  const handleDisconnect = async () => {
    if (!mounted) return;
    console.log('🔌 Disconnecting wallet...');
    await solanaWallet.disconnect();
  };

  return {
    connected: solanaWallet.connected,
    walletAddress: solanaWallet.publicKey?.toBase58() || null,
    connecting: solanaWallet.connecting,
    connect: handleConnect,
    disconnect: handleDisconnect,
    error: null,
    mounted,
  };
}

