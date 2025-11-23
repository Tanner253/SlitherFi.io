import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const PLATFORM_WALLET = new PublicKey('FcAENdG4t6muicnVTUrBkgvysGKqLY3rykCGMc1jzPoP');

export interface PaymentResult {
  success: boolean;
  signature?: string;
  error?: string;
}

/**
 * Confirm transaction using polling (no WebSocket)
 * Many RPC providers don't support WebSocket subscriptions
 */
async function confirmTransactionPolling(
  connection: Connection,
  signature: string,
  maxRetries: number = 60
): Promise<boolean> {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        return true;
      }
      
      if (status?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      }
      
      // Wait 1 second before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    } catch (error) {
      retries++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return false; // Timeout
}

/**
 * Send USDC entry fee to platform wallet
 */
export async function payEntryFee(
  wallet: any, // Solana wallet adapter (from useWallet hook)
  amount: number,
  rpcUrl: string
): Promise<PaymentResult> {
  try {
    // Check if wallet is connected
    if (!wallet || !wallet.publicKey) {
      console.error('❌ Wallet not connected or missing publicKey');
      return {
        success: false,
        error: 'Wallet not connected'
      };
    }
    
    console.log('💳 Processing payment...');
    console.log(`   Amount: $${amount} USDC`);
    console.log(`   Wallet Address: ${wallet.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Wallet Type: ${wallet.adapter?.name || wallet.wallet?.adapter?.name || 'Unknown'}`);
    console.log(`   User Agent: ${navigator.userAgent.slice(0, 50)}...`);
    console.log('   Methods available:', {
      sendTransaction: !!wallet.sendTransaction,
      signTransaction: !!wallet.signTransaction,
    });
    
    // Use polling instead of WebSocket (many RPC providers don't support WS)
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: false,
      confirmTransactionInitialTimeout: 60000, // 60 second timeout
    });
    
    console.log('🔧 Building transaction...');
    
    // Get token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      wallet.publicKey
    );
    
    const toTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      PLATFORM_WALLET
    );
    
    console.log(`   From: ${fromTokenAccount.toBase58().slice(0, 8)}...`);
    console.log(`   To: ${toTokenAccount.toBase58().slice(0, 8)}...`);
    
    // Convert USDC amount to smallest unit (6 decimals)
    const usdcAmount = Math.floor(amount * 1_000_000);
    console.log(`   Amount: ${usdcAmount} (${amount} USDC)`);
    
    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    console.log(`   Blockhash: ${blockhash.slice(0, 8)}...`);
    
    // Create simple Legacy Transaction (works on ALL wallets - mobile and desktop)
    const transaction = new Transaction();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // Add USDC transfer instruction
    transaction.add(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        wallet.publicKey,
        usdcAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    
    console.log(`✅ Transaction built successfully`);
    
    let signature: string;
    
    // Sign and broadcast transaction (SilkRoad's proven mobile-compatible method)
    try {
      if (!wallet.signTransaction) {
        throw new Error('Wallet does not support transaction signing');
      }
      
      console.log('✍️  Step 1: Requesting wallet signature...');
      console.log('⏳ Opening wallet for approval... (check your mobile wallet app)');
      console.log(`   Transaction instructions: ${transaction.instructions.length}`);
      console.log(`   Fee payer: ${transaction.feePayer?.toBase58().slice(0, 8)}...`);
      
      // Sign transaction (opens Phantom - works on mobile!)
        const signed = await wallet.signTransaction(transaction);
      
      console.log('✅ Transaction signed by user!');
      console.log('📡 Step 2: Broadcasting to Solana network...');
      
      // Broadcast the signed transaction ourselves
      signature = await connection.sendRawTransaction(signed.serialize());
      
      console.log(`✅ Transaction broadcast! Signature: ${signature}`);
    } catch (signError: any) {
      console.error('❌ Transaction signing/broadcast failed:', signError);
      console.error('   Error name:', signError.name);
      console.error('   Error message:', signError.message);
      console.error('   Error code:', signError.code);
      
      throw signError; // Re-throw to be caught by outer catch
    }
    
    // Use polling-based confirmation (no WebSocket)
    const confirmResult = await confirmTransactionPolling(connection, signature, 60);
    
    if (!confirmResult) {
      // Return success with warning - user can verify manually
      console.warn('⚠️ Confirmation timeout (payment likely succeeded)');
      return {
        success: true,
        signature,
        error: `Payment sent but confirmation timeout. Verify at: https://solscan.io/tx/${signature}`
      };
    }
    
    console.log('✅ Payment confirmed!');
    
    return {
      success: true,
      signature
    };
  } catch (error: any) {
    console.error('❌ Payment failed:', error);
    
    // Parse common error messages
    let userMessage = error.message || 'Payment failed';
    
    if (error.message?.includes('User rejected') || error.message?.includes('User denied')) {
      userMessage = 'Payment cancelled by user';
    } else if (error.message?.includes('Insufficient funds') || error.message?.includes('insufficient lamports')) {
      userMessage = 'Insufficient SOL for transaction fee';
    } else if (error.message?.includes('Missing signature') || error.message?.includes('Signature verification failed')) {
      userMessage = 'Transaction signing failed. Please try again or use a different wallet.';
    } else if (error.message?.includes('Blockhash not found')) {
      userMessage = 'Network congestion. Please try again.';
    } else if (error.message?.includes('WalletSendTransactionError')) {
      userMessage = 'Mobile wallet error. Please ensure you have the latest wallet version.';
    }
    
    return {
      success: false,
      error: userMessage
    };
  }
}

/**
 * Check if user has enough USDC balance
 */
export async function checkUSDCBalance(
  walletAddress: string,
  requiredAmount: number,
  rpcUrl: string
): Promise<{ hasEnough: boolean; balance: number }> {
  try {
    console.log(`💰 Fetching USDC balance...`);
    console.log(`   Wallet: ${walletAddress.slice(0, 8)}...`);
    
    // No WebSocket subscriptions (HTTP only)
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: false,
    });
    const publicKey = new PublicKey(walletAddress);
    
    const tokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      publicKey
    );
    
    console.log(`   Token Account: ${tokenAccount.toBase58().slice(0, 8)}...`);
    
    const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
    
    // Use uiAmount (number) instead of uiAmountString
    const balance = tokenBalance.value.uiAmount || 0;
    
    console.log(`✅ USDC Balance: $${balance.toFixed(2)}`);
    
    return {
      hasEnough: balance >= requiredAmount,
      balance
    };
  } catch (error: any) {
    // Check if error is "account not found" (no USDC account = 0 balance)
    if (error.message?.includes('could not find account')) {
      console.log('ℹ️ No USDC token account found - balance is $0.00');
      return {
        hasEnough: false,
        balance: 0
      };
    }
    
    // Log error for debugging in production
    console.error('❌ Failed to fetch USDC balance:', error.message || error);
    console.error('   Wallet:', walletAddress);
    
    // Return 0 balance on other errors
    return {
      hasEnough: false,
      balance: 0
    };
  }
}

