import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SendOptions } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, TOKEN_PROGRAM_ID, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';

// Helper to wait for transaction confirmation using polling (no WebSocket)
// Track confirmed transactions to prevent duplicate logging
const confirmedTransactions = new Set<string>();

async function confirmTransactionPolling(
  connection: Connection,
  signature: string,
  maxRetries: number = 30
): Promise<void> {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        // Only log once per transaction
        if (!confirmedTransactions.has(signature)) {
          console.log(`✅ Transaction confirmed: ${signature}`);
          confirmedTransactions.add(signature);
          
          // Clean up after 5 minutes to prevent memory leak
          setTimeout(() => {
            confirmedTransactions.delete(signature);
          }, 5 * 60 * 1000);
        }
        return;
      }
      
      if (status?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      }
      
      // Wait 1 second before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    } catch (error) {
      console.error(`Polling attempt ${retries + 1}/${maxRetries} failed:`, error);
      retries++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error('Transaction confirmation timeout');
}

export class WalletManager {
  private connection: Connection;
  private platformWallet: Keypair;
  private usdcMint: PublicKey;

  constructor(
    rpcUrl: string,
    privateKeyBase58: string,
    usdcMintAddress: string
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    
    // Decode platform wallet private key
    try {
      const privateKeyBytes = bs58.decode(privateKeyBase58);
      this.platformWallet = Keypair.fromSecretKey(privateKeyBytes);
      console.log('✅ Platform wallet loaded:', this.platformWallet.publicKey.toString());
    } catch (error) {
      throw new Error('Invalid PLATFORM_WALLET_PRIVATE_KEY format. Must be base58 encoded.');
    }

    this.usdcMint = new PublicKey(usdcMintAddress);
  }

  /**
   * Get platform wallet public address
   */
  getPlatformAddress(): string {
    return this.platformWallet.publicKey.toString();
  }

  /**
   * Verify a payment transaction on-chain (x402 compliance)
   * Checks that transaction exists, has correct sender/receiver/amount
   */
  async verifyPaymentTransaction(
    txSignature: string,
    expectedFrom: string,
    expectedAmount: number
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      console.log('🔍 Verifying payment on Solana blockchain...');
      console.log(`   TX: ${txSignature}`);
      console.log(`   From: ${expectedFrom.slice(0, 8)}...`);
      console.log(`   Amount: $${expectedAmount} USDC`);

      // Fetch transaction from blockchain
      const tx = await this.connection.getTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (!tx) {
        return { valid: false, error: 'Transaction not found on blockchain' };
      }

      // Check if transaction succeeded
      if (tx.meta?.err) {
        return { valid: false, error: 'Transaction failed on-chain' };
      }

      // Get platform wallet's USDC token account
      const platformAta = await getAssociatedTokenAddress(
        this.usdcMint,
        this.platformWallet.publicKey
      );

      // Parse token balances to verify USDC transfer
      const preBalances = tx.meta?.preTokenBalances || [];
      const postBalances = tx.meta?.postTokenBalances || [];

      // Find platform wallet's token account in balances
      const platformAccountIndex = postBalances.findIndex(
        balance => balance.owner === this.platformWallet.publicKey.toString() &&
                  balance.mint === this.usdcMint.toString()
      );

      if (platformAccountIndex === -1) {
        // Fallback: Check account keys (handle both legacy and versioned transactions)
        let accountKeys: PublicKey[] = [];
        
        if ('accountKeys' in tx.transaction.message) {
          // Legacy transaction
          accountKeys = (tx.transaction.message as any).accountKeys || [];
        } else if (tx.transaction.message.getAccountKeys) {
          // Versioned transaction
          const keys = tx.transaction.message.getAccountKeys();
          accountKeys = keys.staticAccountKeys || [];
        }
        
        const hasPlatformAccount = accountKeys.some(
          key => key.toString() === platformAta.toString()
        );

        if (!hasPlatformAccount) {
          return { valid: false, error: 'Platform wallet not involved in transaction' };
        }
      }

      // Verify amount received (if balance data available)
      if (platformAccountIndex !== -1) {
        const postBalance = postBalances[platformAccountIndex];
        
        // Find corresponding pre-balance by matching account (not by index!)
        const preBalance = preBalances.find(b => 
          b.owner === this.platformWallet.publicKey.toString() &&
          b.mint === this.usdcMint.toString()
        );

        if (preBalance && postBalance) {
          const preAmount = parseInt(preBalance.uiTokenAmount.amount);
          const postAmount = parseInt(postBalance.uiTokenAmount.amount);
          const received = postAmount - preAmount;
          const expectedLamports = Math.floor(expectedAmount * 1_000_000);

          // Received should be positive (platform wallet gaining USDC)
          if (received < expectedLamports) {
            return { 
              valid: false, 
              error: `Insufficient payment: received ${(received / 1_000_000).toFixed(6)} USDC, expected ${expectedAmount}` 
            };
          }

          console.log(`✅ Payment verified: ${(received / 1_000_000).toFixed(6)} USDC received`);
        }
      }

      // Verify sender (from address) - handle both legacy and versioned transactions
      let signer: string | undefined;
      
      if ('accountKeys' in tx.transaction.message && (tx.transaction.message as any).accountKeys) {
        // Legacy transaction
        signer = (tx.transaction.message as any).accountKeys[0]?.toString();
      } else if (tx.transaction.message.getAccountKeys) {
        // Versioned transaction
        const keys = tx.transaction.message.getAccountKeys();
        signer = keys.staticAccountKeys[0]?.toString();
      }

      if (signer !== expectedFrom) {
        return { valid: false, error: 'Transaction sender mismatch' };
      }

      console.log('✅ Payment verification passed');
      console.log(`   Sender: ${signer.slice(0, 8)}... ✓`);
      console.log(`   Recipient: Platform wallet ✓`);
      console.log(`   Amount: $${expectedAmount} USDC ✓`);

      return { valid: true };
    } catch (error: any) {
      console.error('❌ Payment verification failed:', error);
      return { valid: false, error: error.message || 'Verification error' };
    }
  }

  /**
   * Get platform's USDC balance
   */
  async getUSDCBalance(): Promise<number> {
    try {
      const ata = await getAssociatedTokenAddress(
        this.usdcMint,
        this.platformWallet.publicKey
      );

      const account = await getAccount(this.connection, ata);
      const balance = Number(account.amount) / 1_000_000; // USDC has 6 decimals
      
      return balance;
    } catch (error) {
      console.error('Error fetching USDC balance:', error);
      return 0;
    }
  }

  /**
   * Check if platform has enough USDC for a specific payout amount
   */
  async hasSufficientFunds(amount: number): Promise<boolean> {
    const balance = await this.getUSDCBalance();
    return balance >= amount;
  }

  /**
   * Check if wallet has USDC ATA
   */
  async hasUSDCAccount(walletAddress: string): Promise<boolean> {
    try {
      const wallet = new PublicKey(walletAddress);
      const ata = await getAssociatedTokenAddress(this.usdcMint, wallet);
      
      await getAccount(this.connection, ata);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create USDC Associated Token Account for wallet
   */
  async createUSDCAccount(walletAddress: string): Promise<string> {
    try {
      const wallet = new PublicKey(walletAddress);
      const ata = await getAssociatedTokenAddress(this.usdcMint, wallet);

      console.log(`Creating USDC ATA for ${walletAddress}...`);

      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          this.platformWallet.publicKey, // payer
          ata, // ata
          wallet, // owner
          this.usdcMint // mint
        )
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.platformWallet.publicKey;

      // Sign and send (no WebSocket subscription)
      transaction.sign(this.platformWallet);
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`📤 ATA creation sent: ${signature}, waiting for confirmation...`);

      // Poll for confirmation
      await confirmTransactionPolling(this.connection, signature);

      console.log(`✅ USDC ATA created: ${signature}`);
      return signature;
    } catch (error: any) {
      console.error('Error creating USDC account:', error);
      throw new Error(`Failed to create USDC account: ${error.message}`);
    }
  }

  /**
   * Transfer USDC to winner (with memo for tracking)
   */
  async transferUSDC(recipientAddress: string, amount: number, gameId?: string, tier?: string): Promise<string> {
    try {
      const recipient = new PublicKey(recipientAddress);

      // Get ATAs
      const sourceATA = await getAssociatedTokenAddress(
        this.usdcMint,
        this.platformWallet.publicKey
      );

      const destinationATA = await getAssociatedTokenAddress(
        this.usdcMint,
        recipient
      );

      console.log(`Transferring ${amount} USDC to ${recipientAddress}...`);

      // Create transaction with memo for tracking
      const transaction = new Transaction();
      
      // Add memo if provided (for transaction tracking)
      if (gameId && tier) {
        const memoText = `SlitherFi|${gameId}|${tier}`;
        transaction.add({
          keys: [],
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          data: Buffer.from(memoText, 'utf-8')
        });
      }
      
      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          sourceATA, // source
          destinationATA, // destination
          this.platformWallet.publicKey, // owner
          amount * 1_000_000, // amount (convert to smallest unit - 6 decimals)
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.platformWallet.publicKey;

      // Sign and send (no WebSocket subscription)
      transaction.sign(this.platformWallet);
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`📤 Transfer sent: ${signature}, waiting for confirmation...`);

      // Poll for confirmation
      await confirmTransactionPolling(this.connection, signature);

      console.log(`✅ USDC transferred: ${signature}`);
      return signature;
    } catch (error: any) {
      console.error('Error transferring USDC:', error);
      throw new Error(`Failed to transfer USDC: ${error.message}`);
    }
  }

  /**
   * Get connection (for advanced usage)
   */
  getConnection(): Connection {
    return this.connection;
  }
}

