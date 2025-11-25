'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from './components/useWallet';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { TransactionLog } from './components/TransactionLog';
import { Leaderboard } from './components/Leaderboard';
import { createPaymentPayload, encodePaymentPayload, type PaymentRequiredResponse } from './lib/x402';
import { signChallenge, encodeAuthHeader, type AuthRequiredResponse, type AuthChallenge } from './lib/x403';
import { AuthModal } from './components/AuthModal';
import { ProfileModal } from './components/ProfileModal';
import SnowEffect from './components/SnowEffect';

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: number;
}

interface GameMode {
  tier: string;
  buyIn: number;
  name: string;
  maxPlayers: number;
  locked?: boolean;
  statMultiplier?: number;
}

interface LobbyStatus {
  tier: string;
  playersLocked: number;
  realPlayerCount: number;
  botCount?: number;
  maxPlayers: number;
  min?: number;
  status: string;
  countdown: number | null;
  spectatorCount?: number;
  timeRemaining?: number | null;
  dreamCooldown?: number | null;
  potSize?: number;
}

export default function HomePage() {
  const router = useRouter();
  const { connected, walletAddress, disconnect, connect } = useWallet();
  const solanaWallet = useSolanaWallet();
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [gameModes, setGameModes] = useState<GameMode[]>([]);
  const [lobbies, setLobbies] = useState<LobbyStatus[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [selectedMode, setSelectedMode] = useState<'play' | 'spectate' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [adventureStep, setAdventureStep] = useState<'home' | 'journey' | 'destination'>(connected ? 'journey' : 'home');
  const [payingForTier, setPayingForTier] = useState<string | null>(null);
  const [showCountdownWarning, setShowCountdownWarning] = useState(false);
  const [pendingJoinTier, setPendingJoinTier] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [appleBalance, setAppleBalance] = useState<number>(0);
  
  // x403 Auth State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authChallenge, setAuthChallenge] = useState<AuthChallenge | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAuthCallback, setPendingAuthCallback] = useState<(() => void) | null>(null);
  
  // Profile Modal State
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Chat State
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Stats State
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showTransactionLog, setShowTransactionLog] = useState(false);
  const [connectedClients, setConnectedClients] = useState(0);
  const [playersInGame, setPlayersInGame] = useState(0);
  const [totalSpectators, setTotalSpectators] = useState(0);

  // Contract Address
  const CONTRACT_ADDRESS = 'JAxqon7z7uzjZ5f97amnytgrEDJMbVnPxRFqPzwwpump';
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Socket connection for real-time updates and chat
  useEffect(() => {
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

    // Initial fetch
    fetch(`${serverUrl}/api/game-modes`)
      .then(res => res.json())
      .then(data => {
        setGameModes(data.modes || []);
        setLobbies(data.lobbies || []);
      })
      .catch(console.error);

    // Create socket connection
    const socket = require('socket.io-client').io(serverUrl);

    socket.on('lobbyUpdate', (update: LobbyStatus) => {
      setLobbies(prev => {
        const index = prev.findIndex(l => l.tier === update.tier);
        if (index >= 0) {
          if (JSON.stringify(prev[index]) === JSON.stringify(update)) {
            return prev; // No change
          }
          const newLobbies = [...prev];
          newLobbies[index] = update;
          return newLobbies;
        } else {
          return [...prev, update];
        }
      });
    });

    socket.on('chatMessage', (msg: { username: string; message: string }) => {
      const newMsg: ChatMessage = {
        id: Date.now().toString(),
        username: msg.username,
        message: msg.message,
        timestamp: Date.now()
      };
      setChatMessages(prev => {
        const newMessages = [...prev, newMsg];
        return newMessages.slice(-100); // Keep only last 100
      });
    });

    // Listen for stats updates
    socket.on('statsUpdate', (stats: { connectedClients: number; playersInGame: number; totalSpectators: number }) => {
      setConnectedClients(stats.connectedClients);
      setPlayersInGame(stats.playersInGame);
      setTotalSpectators(stats.totalSpectators);
    });

    // Fetch initial stats
    fetch(`${serverUrl}/api/stats`)
      .then(res => res.json())
      .then((stats: { connectedClients: number; playersInGame: number; totalSpectators: number }) => {
        setConnectedClients(stats.connectedClients);
        setPlayersInGame(stats.playersInGame);
        setTotalSpectators(stats.totalSpectators);
      })
      .catch(console.error);

    // Store socket globally for chat
    (window as any).gameSocket = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // Load chat history
  useEffect(() => {
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    fetch(`${serverUrl}/api/chat`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && Array.isArray(data.messages)) {
          const recentMessages = data.messages.slice(-100).map((msg: any) => ({
            id: msg._id || msg.timestamp?.toString() || Date.now().toString(),
            username: msg.username,
            message: msg.message,
            timestamp: msg.timestamp
          }));
          setChatMessages(recentMessages);
        }
      })
      .catch(console.error);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (showChat) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [showChat, chatMessages]);

  // ESC key to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowChat(false);
        setShowLeaderboard(false);
        setShowTransactionLog(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load session token from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('x403SessionToken');
    if (storedToken) {
      setSessionToken(storedToken);
      console.log('✅ x403: Session token loaded from localStorage');
    }
  }, []);

  // Clear session when wallet disconnects
  useEffect(() => {
    if (!connected) {
      setSessionToken(null);
      localStorage.removeItem('x403SessionToken');
      localStorage.removeItem('x403SessionExpiry');
      console.log('🧹 x403: Session cleared (wallet disconnected)');
    }
  }, [connected]);

  // Check if URL has error query param
  useEffect(() => {
    // Use URLSearchParams to get query parameters
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const error = urlParams.get('error');
      
      if (error) {
        setToastMessage(`⚠️ ${decodeURIComponent(error)}`);
        
        // Clean up URL without reloading
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, []);

  // Fetch username from database when wallet connects
  useEffect(() => {
    const fetchUsername = async () => {
      if (connected && walletAddress) {
        try {
          const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
          const response = await fetch(`${serverUrl}/api/user/${walletAddress}`);
          const data = await response.json();
          
          if (data.user && data.user.username) {
            setPlayerName(data.user.username);
            setDraftName(data.user.username);
          } else {
            setPlayerName('');
            setDraftName('');
          }
        } catch (error) {
          console.error('Failed to fetch username:', error);
        }
      } else {
        setPlayerName('');
        setDraftName('');
      }
    };

    fetchUsername();
  }, [connected, walletAddress]);

  // Fetch USDC balance directly from Solana (client-side)
  useEffect(() => {
    let balanceInterval: NodeJS.Timeout | null = null;
    let isMounted = true;
    
    if (connected && walletAddress) {
      const fetchBalance = async () => {
        try {
          const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC;
          
          if (!rpcUrl) {
            console.warn('⚠️ RPC endpoint not configured');
            if (isMounted) {
              setUsdcBalance(0);
            }
            return;
          }
          
          console.log('🔄 Fetching USDC balance...');
          const { checkUSDCBalance } = await import('./utils/payment');
          const result = await checkUSDCBalance(walletAddress, 0, rpcUrl);
          
          if (isMounted) {
            setUsdcBalance(result.balance);
          }
        } catch (error: any) {
          console.error('❌ Error fetching USDC balance:', error.message || error);
          if (isMounted) {
            setUsdcBalance(0); // Show 0 instead of null on error
          }
        }
      };
      
      // Fetch immediately
      fetchBalance();
      
      // Refresh balance every 30 seconds
      balanceInterval = setInterval(fetchBalance, 30000);
    } else {
      // Clear balance when wallet disconnects
      setUsdcBalance(null);
    }
    
    return () => {
      isMounted = false;
      if (balanceInterval) {
        clearInterval(balanceInterval);
      }
    };
  }, [connected, walletAddress]);

  // Fetch apple balance from server
  useEffect(() => {
    let isMounted = true;
    
    if (connected && walletAddress) {
      const fetchApples = async () => {
        try {
          const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
          const res = await fetch(`${serverUrl}/api/user/${walletAddress}`);
          const data = await res.json();
          
          if (isMounted && data.user) {
            setAppleBalance(data.user.apples || 0);
          }
        } catch (error) {
          console.error('Failed to fetch apple balance:', error);
          if (isMounted) {
            setAppleBalance(0);
          }
        }
      };
      
      fetchApples();
    } else {
      setAppleBalance(0);
    }
    
    return () => {
      isMounted = false;
    };
  }, [connected, walletAddress]);

  // Update adventure step based on connection status
  useEffect(() => {
    if (connected && adventureStep === 'home') {
      setAdventureStep('journey');
    } else if (!connected) {
      setAdventureStep('home');
      setSelectedMode(null);
    }
  }, [connected]);

  // Chat function
  const sendChatMessage = () => {
    if (!connected) {
      setToastMessage('⚠️ Connect wallet to chat');
      return;
    }
    
    if (!chatInput.trim() || !playerName.trim()) return;
    
    const socket = (window as any).gameSocket;
    if (socket) {
      socket.emit('chatMessage', {
        username: playerName,
        message: chatInput.trim(),
        walletAddress: walletAddress || null
      });
      setChatInput('');
    }
  };

  // Auth modal handlers
  const handleAuthSign = async () => {
    if (pendingAuthCallback) {
      pendingAuthCallback();
    }
  };

  const handleAuthCancel = () => {
    setShowAuthModal(false);
    setAuthChallenge(null);
    setAuthError(null);
    setIsAuthenticating(false);
    setPendingAuthCallback(null);
  };

  // x403 Authentication function
  const authenticate = async (): Promise<string | null> => {
    if (!connected || !walletAddress) {
      setToastMessage('🔒 Please connect your wallet');
      return null;
    }

    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

    // Check if we have a valid session token
    const storedToken = localStorage.getItem('x403SessionToken');
    const storedExpiry = localStorage.getItem('x403SessionExpiry');

    if (storedToken && storedExpiry) {
      const expiryTime = parseInt(storedExpiry);
      
      if (Date.now() < expiryTime) {
        console.log('✅ x403: Using existing session token');
        setSessionToken(storedToken);
        return storedToken;
      } else {
        console.log('⏰ x403: Session expired, need new signature');
        localStorage.removeItem('x403SessionToken');
        localStorage.removeItem('x403SessionExpiry');
      }
    }

    // Need new authentication - request challenge
    try {
      console.log('📋 x403: Requesting authentication challenge...');
      
      const challengeResponse = await fetch(`${serverUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress })
      });

      // Check for rate limiting
      if (challengeResponse.status === 429) {
        const rateLimitData = await challengeResponse.json();
        setToastMessage(rateLimitData.error || '⚠️ Too many failed attempts. Please wait.');
        return null;
      }

      // Check for existing session
      if (challengeResponse.ok) {
        const data = await challengeResponse.json();
        
        if (data.existingSession) {
          console.log('✅ x403: Server found existing session');
          setSessionToken(data.sessionToken);
          localStorage.setItem('x403SessionToken', data.sessionToken);
          localStorage.setItem('x403SessionExpiry', new Date(data.expiresAt).getTime().toString());
          return data.sessionToken;
        }
      }

      // Get challenge (403 response expected)
      if (challengeResponse.status !== 403) {
        throw new Error('Expected 403 Forbidden with challenge');
      }

      const authRequired: AuthRequiredResponse = await challengeResponse.json();
      
      console.log('✅ x403: Challenge received');
      setAuthChallenge(authRequired.challenge);
      setAuthError(null);

      // Show modal and wait for user to sign
      return new Promise((resolve) => {
        setShowAuthModal(true);
        
        // Store callback to resume after signing
        setPendingAuthCallback(() => async () => {
          try {
            setIsAuthenticating(true);
            setAuthError(null);

            // Sign challenge
            const signResult = await signChallenge(authRequired.challenge, solanaWallet);

            if (!signResult.success) {
              setAuthError(signResult.error || 'Signing failed');
              setIsAuthenticating(false);
              resolve(null);
              return;
            }

            // Send signed challenge to server
            console.log('📨 x403: Sending signed challenge to server...');
            
            const authHeader = encodeAuthHeader(signResult.signedChallenge!);

            const verifyResponse = await fetch(`${serverUrl}/api/auth/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
              },
              body: JSON.stringify({ walletAddress })
            });

            if (verifyResponse.status === 429) {
              const rateLimitData = await verifyResponse.json();
              setAuthError(rateLimitData.error || 'Too many failed attempts');
              setIsAuthenticating(false);
              resolve(null);
              return;
            }

            if (!verifyResponse.ok) {
              const errorData = await verifyResponse.json();
              setAuthError(errorData.error || 'Verification failed');
              setIsAuthenticating(false);
              resolve(null);
              return;
            }

            const verifyData = await verifyResponse.json();

            if (!verifyData.authenticated || !verifyData.sessionToken) {
              setAuthError('Authentication failed');
              setIsAuthenticating(false);
              resolve(null);
              return;
            }

            console.log('✅ x403: Authentication successful!');
            
            // Store session token
            setSessionToken(verifyData.sessionToken);
            localStorage.setItem('x403SessionToken', verifyData.sessionToken);
            localStorage.setItem('x403SessionExpiry', new Date(verifyData.expiresAt).getTime().toString());

            setShowAuthModal(false);
            setIsAuthenticating(false);
            setAuthChallenge(null);
            // Suppress toast to avoid double feedback
            // setToastMessage('✅ Wallet verified successfully!');
            
            resolve(verifyData.sessionToken);
          } catch (error: any) {
            console.error('❌ x403 authentication error:', error);
            setAuthError(error.message || 'Authentication failed');
            setIsAuthenticating(false);
            resolve(null);
          }
        });
      });
    } catch (error: any) {
      console.error('❌ x403 challenge request failed:', error);
      setToastMessage(`⚠️ Authentication error: ${error.message}`);
      return null;
    }
  };

  // Join game with x403 authentication
  const handleJoinGame = async (tier: string) => {
    if (!connected) {
      setToastMessage('⚠️ Connect your wallet first!');
      return;
    }

    if (!playerName.trim()) {
      setToastMessage('⚠️ Enter your name to play');
      return;
    }

    // x403 AUTHENTICATION - Required before joining
    console.log('🔐 x403: Checking authentication...');
    const activeToken = await authenticate();
    
    if (!activeToken) {
      console.log('❌ x403: Authentication failed or cancelled');
      return;
    }

    console.log('✅ x403: Authenticated successfully');

    // Check if tier requires payment
    const gameMode = gameModes.find(m => m.tier === tier);
    const requiresPayment = tier !== 'dream';
    
    if (requiresPayment && gameMode) {
      // Check if countdown already started - show warning
      const lobby = lobbies.find(l => l.tier === tier);
      if (lobby?.countdown !== null && lobby?.countdown !== undefined && lobby.countdown > 0) {
        setPendingJoinTier(tier);
        setShowCountdownWarning(true);
        return;
      }
      
      // Process payment using the fresh token
      await handlePaymentAndJoin(tier, gameMode.buyIn, activeToken);
    } else {
      // Free tier (Dream Mode) - join directly
      await joinDreamMode(tier, activeToken);
    }
  };

  // Handle payment and join for paid tiers
  const handlePaymentAndJoin = async (tier: string, entryFee: number, activeSessionToken: string | null) => {
    setPayingForTier(tier);
    
    // Use the passed token or fallback to state (state might be stale in closure)
    const tokenToUse = activeSessionToken || sessionToken;
    
    try {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC;
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      
      if (!rpcUrl) {
        setToastMessage('⚠️ RPC endpoint not configured');
        setPayingForTier(null);
        return;
      }

      // Check USDC balance
      const { checkUSDCBalance } = await import('./utils/payment');
      const balanceCheck = await checkUSDCBalance(walletAddress!, entryFee, rpcUrl);
      
      if (!balanceCheck.hasEnough) {
        setToastMessage(`⚠️ Insufficient USDC. You have $${balanceCheck.balance.toFixed(2)}, need $${entryFee}`);
        setPayingForTier(null);
        return;
      }
      
      const playerId = `player_${Date.now()}`;

      // x402: Request payment requirements
      console.log('📋 x402: Requesting payment requirements...');
      
      const initialResponse = await fetch(`${serverUrl}/api/join-lobby`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-SESSION': tokenToUse || ''
        },
        body: JSON.stringify({
          tier,
          playerId,
          playerName,
          walletAddress
        })
      });

      if (initialResponse.status !== 402) {
        if (initialResponse.status === 403) {
           throw new Error('Authentication expired. Please try again.');
        }
        throw new Error('Expected 402 Payment Required response');
      }

      const paymentRequired: PaymentRequiredResponse = await initialResponse.json();
      console.log('✅ Got 402 Payment Required');

      // Get payment requirements from the response
      const paymentReq = paymentRequired.accepts[0];

      // x402: Make payment
      console.log('💳 x402: Processing USDC payment...');
      const { payEntryFee } = await import('./utils/payment');
      const paymentResult = await payEntryFee(solanaWallet, entryFee, rpcUrl, paymentReq.payTo, paymentReq.asset);
      
      if (!paymentResult.success) {
        setToastMessage(`💳 Payment failed: ${paymentResult.error}`);
        setPayingForTier(null);
        return;
      }
      
      console.log(`✅ Payment successful: ${paymentResult.signature}`);

      // Update balance
      if (usdcBalance !== null) {
        setUsdcBalance(usdcBalance - entryFee);
      }
      
      // x402: Send payment proof
      console.log('📨 x402: Sending payment proof...');
      
      const paymentPayload = createPaymentPayload(
        paymentResult.signature!,
        walletAddress!,
        paymentReq.payTo,
        entryFee,
        paymentReq.asset
      );
      const paymentHeader = encodePaymentPayload(paymentPayload);

      const joinResponse = await fetch(`${serverUrl}/api/join-lobby`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
          'X-SESSION': tokenToUse || ''
        },
        body: JSON.stringify({
          tier,
          playerId,
          playerName,
          walletAddress
        })
      });

      const joinResult = await joinResponse.json();

      if (!joinResult.success || !joinResult.lobbyToken) {
        setToastMessage(`⚠️ Failed to join: ${joinResult.error || 'Unknown error'}`);
        setPayingForTier(null);
        return;
      }

      console.log('✅ Successfully joined lobby!');
      
      // Store credentials for game page
      localStorage.setItem('lobbyToken', joinResult.lobbyToken);
      localStorage.setItem('selectedTier', tier);
      localStorage.setItem('playerId', playerId);
      localStorage.setItem('spectateMode', 'false');
      
      setPayingForTier(null);
      router.push('/game');
      
    } catch (error: any) {
      console.error('❌ Payment/join error:', error);
      setToastMessage(`⚠️ Error: ${error.message}`);
      setPayingForTier(null);
    }
  };

  // Join Dream Mode (free)
  const joinDreamMode = async (tier: string, activeSessionToken: string | null = null) => {
    try {
      const playerId = `player_${Date.now()}`;
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

      console.log('🎟️ Requesting free lobby token for Dream Mode...');

      const tokenToUse = activeSessionToken || sessionToken;

      const response = await fetch(`${serverUrl}/api/join-lobby`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-SESSION': tokenToUse || ''
        },
        body: JSON.stringify({
          tier,
          playerId,
          playerName,
          walletAddress
        })
      });

      const result = await response.json();

      if (!result.success || !result.lobbyToken) {
        setToastMessage(`⚠️ Failed to join: ${result.error || 'Unknown error'}`);
        return;
      }

      console.log('✅ Successfully joined Dream Mode!');
      
      // Store credentials for game page
      localStorage.setItem('lobbyToken', result.lobbyToken);
      localStorage.setItem('selectedTier', tier);
      localStorage.setItem('playerId', playerId);
      localStorage.setItem('spectateMode', 'false');
      
      router.push('/game');
      
    } catch (error: any) {
      console.error('❌ Dream Mode join error:', error);
      setToastMessage(`⚠️ Error: ${error.message}`);
    }
  };

  // Check if there are active games for spectating
  const hasActiveGames = lobbies.filter(l => l.status === 'playing').length > 0;

  // Save username to database
  const saveUsername = async (username: string) => {
    if (!connected || !walletAddress || !username.trim()) return;
    
    try {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      await fetch(`${serverUrl}/api/user/update-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          username: username.trim()
        })
      });
      // Update the main playerName state to switch views
      setPlayerName(username.trim());
    } catch (error) {
      console.error('Failed to save username:', error);
    }
  };

  const handleNameSubmit = () => {
    if (draftName.trim()) {
      saveUsername(draftName);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-b from-green-950 via-emerald-900 to-green-950">
      {/* Christmas snow effect */}
      <SnowEffect />
      
      {/* Jungle vines and foliage background */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-64 h-64 bg-green-600 rounded-full blur-3xl" />
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-emerald-600 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-lime-600 rounded-full blur-3xl" />
      </div>
      
      {/* Animated vines - Simplified to avoid SVG path errors */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <svg className="w-full h-full">
          <defs>
            <linearGradient id="vineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{stopColor:'#22c55e', stopOpacity:0.6}} />
              <stop offset="100%" style={{stopColor:'#16a34a', stopOpacity:1}} />
            </linearGradient>
          </defs>
          <motion.g
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M 100,0 Q 120,100 100,200 Q 80,300 100,400 Q 120,500 100,600"
              fill="none"
              stroke="url(#vineGradient)"
              strokeWidth="3"
            />
          </motion.g>
          <motion.g
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 3 }}
          >
            <path
              d="M 300,0 Q 320,120 300,240 Q 280,360 300,480 Q 320,600 300,720"
              fill="none"
              stroke="url(#vineGradient)"
              strokeWidth="3"
            />
          </motion.g>
        </svg>
      </div>

      {/* Header */}
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="relative z-50 border-b border-green-700/30 bg-black/60 backdrop-blur-lg"
      >
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ 
                  rotate: [0, 10, -10, 0],
                  scale: [1, 1.1, 1.1, 1]
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="text-2xl md:text-3xl"
              >
                🐍
              </motion.div>
              <h1 className="text-xl md:text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-lime-400 via-green-400 to-emerald-500">
                SnekFi
              </h1>
            </div>
            
            {/* Stats Display - Desktop */}
            <div className="hidden lg:flex items-center gap-2 md:gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-gray-400">
                <div className="w-2 h-2 bg-gray-400 rounded-full" />
                <span className="font-bold text-white">{connectedClients}</span> online
              </span>
              <span className="text-gray-600">•</span>
              <span className="flex items-center gap-1.5 text-gray-400">
                <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                <span className="font-bold text-green-400">{playersInGame}</span> in game
              </span>
              <span className="text-gray-600">•</span>
              <span className="flex items-center gap-1.5 text-gray-400">
                <svg className="w-3 h-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="font-bold text-purple-400">{totalSpectators}</span> spectating
              </span>
              <span className="text-gray-600">•</span>
              <span className="flex items-center gap-1.5 text-gray-400">
                <svg className="w-3 h-3 text-lime-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="font-bold text-lime-400">{connectedClients - playersInGame - totalSpectators}</span> browsing
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Leaderboard Button */}
            <motion.button
              onClick={() => setShowLeaderboard(true)}
              className="px-2 md:px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-xs font-bold hover:bg-yellow-500/20 transition-all flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <span className="hidden sm:inline">🏆 Top 50</span>
              <span className="sm:hidden">🏆</span>
            </motion.button>

            {/* Transaction Log Button */}
            <motion.button
              onClick={() => setShowTransactionLog(true)}
              className="px-2 md:px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-xs font-bold hover:bg-green-500/20 transition-all flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden sm:inline">Payouts</span>
            </motion.button>
            
            {connected ? (
              <>
                <button
                  onClick={() => setShowProfileModal(true)}
                  className="p-2 hover:bg-green-900/50 rounded-lg transition-all group"
                  title="View Profile"
                >
                  <span className="text-xl md:text-2xl group-hover:scale-110 transition-transform inline-block">👤</span>
                </button>
                <div className="hidden md:flex items-center gap-2">
                  {usdcBalance !== null && (
                    <div className="flex items-center bg-green-900/30 px-3 py-1.5 rounded-lg border border-green-700/30">
                      <span className="text-xs text-green-400 font-bold">
                        💰 ${usdcBalance.toFixed(2)} USDC
                      </span>
                    </div>
                  )}
                  <div className="flex items-center bg-red-900/30 px-3 py-1.5 rounded-lg border border-red-700/30">
                    <span className="text-xs text-red-400 font-bold">
                      🎁 {appleBalance}
                    </span>
                  </div>
                </div>
                <button
                  onClick={disconnect}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 hover:bg-red-900/50 transition-all text-xs md:text-sm font-bold"
                >
                  Leave
                </button>
              </>
            ) : (
              <button
                onClick={connect}
                className="px-4 md:px-6 py-2 md:py-3 bg-gradient-to-r from-lime-600 to-green-600 rounded-lg font-bold hover:scale-105 transition-transform shadow-lg shadow-green-900/50 text-sm md:text-base"
              >
                Enter Jungle
              </button>
            )}
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {/* Landing: Choose Your Adventure */}
        {adventureStep === 'home' && !connected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <motion.div 
              className="mb-12"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.8 }}
            >
              <div className="text-8xl mb-6 flex justify-center gap-4">
                <motion.span
                  animate={{ y: [0, -20, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0 }}
                >🐍</motion.span>
                <motion.span
                  animate={{ y: [0, -20, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.2 }}
                >🌿</motion.span>
                <motion.span
                  animate={{ y: [0, -20, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.4 }}
                >💰</motion.span>
              </div>
              <h2 className="text-6xl md:text-8xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-r from-lime-300 via-green-400 to-emerald-500">
                SnekFi
            </h2>
              <p className="text-2xl md:text-3xl text-green-300 mb-4 font-bold">
                The Crypto Jungle Awaits
              </p>
              <p className="text-lg text-emerald-400/70 mb-12">
                Navigate treacherous paths. Outsmart rivals. Claim USDC treasures.
              </p>
          </motion.div>

            <motion.button
              onClick={connect}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="group relative px-12 py-6 bg-gradient-to-r from-lime-500 via-green-500 to-emerald-600 rounded-2xl font-black text-2xl text-white shadow-2xl shadow-green-900/50 overflow-hidden"
              initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-lime-400 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative z-10 flex items-center gap-3">
                🌴 Begin Your Adventure
                <svg className="w-8 h-8 group-hover:translate-x-2 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            </motion.button>

            {/* Features - Jungle themed */}
                    <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="mt-24 grid md:grid-cols-3 gap-8"
            >
              <div className="p-6 bg-green-900/20 border border-green-700/30 rounded-2xl backdrop-blur-sm">
                <div className="text-5xl mb-4">🔐</div>
                <h3 className="text-xl font-bold text-green-300 mb-2">x402 & x403</h3>
                <p className="text-emerald-400/70">Secure wallet auth & on-chain payment verification. Play trustlessly.</p>
                      </div>
              <div className="p-6 bg-green-900/20 border border-green-700/30 rounded-2xl backdrop-blur-sm">
                <div className="text-5xl mb-4">🎁</div>
                <h3 className="text-xl font-bold text-green-300 mb-2">Free Cosmetics</h3>
                <p className="text-emerald-400/70">Collect presents in-game. Unlock exclusive skins. Show off your style.</p>
                    </div>
              <div className="p-6 bg-green-900/20 border border-green-700/30 rounded-2xl backdrop-blur-sm">
                <div className="text-5xl mb-4">💰</div>
                <h3 className="text-xl font-bold text-green-300 mb-2">Fair Fees</h3>
                <p className="text-emerald-400/70">15% fee on paid games funds Dream Mode, marketing, and development. Dream Mode is 100% free.</p>
                    </div>
                  </motion.div>
          </motion.div>
        )}

        {/* Store Banner */}
        {adventureStep === 'journey' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-5xl mx-auto mb-8"
          >
            <motion.button
              onClick={() => router.push('/store')}
              className="w-full bg-gradient-to-r from-red-900/40 to-orange-900/40 border-2 border-yellow-400/50 rounded-2xl p-6 hover:border-yellow-400 transition-all group overflow-hidden relative"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-red-600/20 to-orange-600/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="text-5xl">🏪</div>
                  <div className="text-left">
                    <div className="text-2xl font-black text-yellow-400 mb-1">Cosmetics Store</div>
                    <div className="text-sm text-yellow-200">Spend your apples on exclusive skins!</div>
                  </div>
                </div>
                
                <motion.div
                  animate={{ rotate: [-15, 15, -15] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="text-6xl"
                >
                  🎁
                </motion.div>
              </div>
            </motion.button>
          </motion.div>
        )}

        {/* Journey Selection: Choose Your Path */}
        {adventureStep === 'journey' && !selectedMode && (
                    <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="max-w-5xl mx-auto"
          >
            <div className="text-center mb-16">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring" }}
                className="inline-block mb-6"
              >
                <div className="text-7xl">🗺️</div>
                    </motion.div>
              <h2 className="text-5xl font-black text-green-300 mb-4">
                Choose Your Path
              </h2>
              <p className="text-xl text-emerald-400/70">
                Two trails through the jungle. Which will you take?
              </p>
                    </div>

            {/* Path Choices - Jungle Style */}
            <div className="relative">
              {/* Connecting Path Visual */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-1 bg-gradient-to-r from-lime-600 via-emerald-600 to-green-600 hidden md:block" />
              
              <div className="grid md:grid-cols-2 gap-12">
                {/* Battle Path */}
                <motion.button
                  onClick={() => setSelectedMode('play')}
                  whileHover={{ scale: 1.05, y: -10 }}
                  whileTap={{ scale: 0.95 }}
                  className="group relative p-8 bg-gradient-to-br from-yellow-900/40 via-green-900/40 to-emerald-900/40 border-4 border-yellow-600/40 rounded-3xl hover:border-yellow-500 transition-all overflow-hidden shadow-2xl"
                  initial={{ opacity: 0, x: -50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/0 to-emerald-500/0 group-hover:from-yellow-500/20 group-hover:to-emerald-500/20 transition-all" />
                  <div className="relative z-10">
                    <div className="text-8xl mb-6">⚔️</div>
                    <h3 className="text-4xl font-black text-yellow-300 mb-4">Battle Path</h3>
                    <p className="text-green-200 text-lg mb-6 leading-relaxed">
                      Face rivals in combat. Risk your tokens. Seize the treasure chest.
                    </p>
                    <div className="space-y-2 text-left mb-6 text-sm text-emerald-300">
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Real USDC prizes</span>
                              </div>
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Competitive stakes</span>
                          </div>
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400">⭐</span>
                        <span>Winner takes 80% pot</span>
                    </div>
                  </div>
                    <div className="inline-flex items-center gap-3 text-yellow-300 font-black text-lg">
                      <span>Enter Battle Arena</span>
                      <svg className="w-6 h-6 group-hover:translate-x-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      </div>
                    </div>
                </motion.button>

                {/* Observer Path */}
                <motion.button
                  onClick={() => hasActiveGames && setSelectedMode('spectate')}
                  whileHover={hasActiveGames ? { scale: 1.05, y: -10 } : {}}
                  whileTap={hasActiveGames ? { scale: 0.95 } : {}}
                  disabled={!hasActiveGames}
                  className={`group relative p-8 bg-gradient-to-br from-purple-900/40 via-blue-900/40 to-indigo-900/40 border-4 ${
                    hasActiveGames 
                      ? 'border-purple-600/40 hover:border-purple-500 cursor-pointer' 
                      : 'border-gray-600/40 cursor-not-allowed opacity-50'
                  } rounded-3xl transition-all overflow-hidden shadow-2xl`}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br from-purple-500/0 to-blue-500/0 ${
                    hasActiveGames ? 'group-hover:from-purple-500/20 group-hover:to-blue-500/20' : ''
                  } transition-all`} />
                  <div className="relative z-10">
                    <div className="text-8xl mb-6">{hasActiveGames ? '🔭' : '🌙'}</div>
                    <h3 className="text-4xl font-black text-purple-300 mb-4">Observer Path</h3>
                    <p className="text-blue-200 text-lg mb-6 leading-relaxed">
                      {hasActiveGames 
                        ? 'Watch from the canopy. Learn tactics. No risk, pure entertainment.' 
                        : 'The jungle sleeps. No battles to observe right now.'}
                    </p>
                    {hasActiveGames ? (
                      <div className="space-y-2 text-left mb-6 text-sm text-indigo-300">
                        <div className="flex items-center gap-2">
                          <span className="text-purple-400">✦</span>
                          <span>Watch live battles</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-purple-400">✦</span>
                          <span>Learn from the best</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-purple-400">✦</span>
                          <span>Free to spectate</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-400 text-sm italic">
                        Return later when battles are active
                      </div>
                    )}
                    <div className={`inline-flex items-center gap-3 font-black text-lg ${
                      hasActiveGames ? 'text-purple-300' : 'text-gray-500'
                    }`}>
                      <span>{hasActiveGames ? 'Enter Observatory' : 'No Active Games'}</span>
                      {hasActiveGames && (
                        <svg className="w-6 h-6 group-hover:translate-x-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      )}
                    </div>
                  </div>
                </motion.button>
                    </div>
                  </div>
                </motion.div>
        )}

        {/* Play Mode: Destination - Battle Arena */}
        <AnimatePresence mode="wait">
          {selectedMode === 'play' && (
                <motion.div
              key="play-mode"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
            >
              <div className="flex items-center gap-4 mb-8">
                <button
                  onClick={() => setSelectedMode(null)}
                  className="p-3 hover:bg-green-900/50 rounded-xl transition-colors border border-green-700/30"
                >
                  <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                      <div>
                  <div className="flex items-center gap-3">
                    <span className="text-5xl">⚔️</span>
                    <h2 className="text-5xl font-black text-yellow-300">Battle Arena</h2>
                        </div>
                  <p className="text-emerald-400/70 mt-2">Select your combat tier and stake</p>
                      </div>
                    </div>

              {!connected ? (
                <motion.div 
                  className="text-center py-20 bg-gradient-to-br from-yellow-900/20 to-orange-900/20 rounded-3xl border-2 border-yellow-700/30"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <div className="text-8xl mb-6">🔒</div>
                  <h3 className="text-3xl font-bold text-yellow-300 mb-4">Gate Sealed</h3>
                  <p className="text-emerald-400/70 text-lg mb-8">Connect your wallet to enter the battle arena</p>
                  <button
                    onClick={connect}
                    className="px-10 py-5 bg-gradient-to-r from-lime-500 to-green-600 rounded-xl font-black text-xl hover:scale-105 transition-transform shadow-lg shadow-green-900/50"
                  >
                    🌴 Connect Wallet
                  </button>
                </motion.div>
              ) : !playerName.trim() ? (
                <motion.div 
                  className="text-center py-20 bg-gradient-to-br from-blue-900/30 to-cyan-900/30 rounded-3xl border-2 border-cyan-700/50"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <div className="text-8xl mb-6">✍️</div>
                  <h3 className="text-3xl font-bold text-cyan-300 mb-4">Name Your Snek</h3>
                  <p className="text-emerald-400/70 text-lg mb-8">Set your name to begin your journey</p>
                  
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={handleNameSubmit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                        handleNameSubmit();
                      }
                    }}
                    placeholder="Enter your snek name..."
                    maxLength={15}
                    className="px-6 py-4 bg-green-950 border-2 border-green-700 rounded-xl text-white text-xl font-bold text-center placeholder:text-green-700 focus:outline-none focus:border-cyan-500 transition-all max-w-md mx-auto block"
                    autoFocus
                  />
                  <p className="text-sm text-green-400/50 mt-4">Press Enter or click away to save</p>
                </motion.div>
              ) : (
                <div className="space-y-6">
                  {/* Static Username Display */}
                  <div className="text-center mb-8 bg-green-950/30 py-4 rounded-xl border border-green-800/30">
                    <p className="text-emerald-400/50 text-sm uppercase tracking-wider font-bold mb-1">Playing As</p>
                    <h3 className="text-3xl font-black text-white">{playerName}</h3>
                    <button 
                      onClick={() => setShowProfileModal(true)}
                      className="text-xs text-green-500 hover:text-green-300 mt-2 underline"
                    >
                      Change Name
                    </button>
                  </div>

                  {gameModes.filter(mode => !mode.locked).length === 0 ? (
                    <div className="col-span-full text-center py-20 bg-gradient-to-br from-yellow-900/20 to-orange-900/20 rounded-3xl border-2 border-yellow-700/30">
                      <div className="text-8xl mb-6">⏳</div>
                      <h3 className="text-3xl font-bold text-yellow-300 mb-4">Loading Arenas...</h3>
                      <p className="text-emerald-400/70">Preparing battle grounds. One moment.</p>
                    </div>
                  ) : (
                    <>
                      {/* Dream Mode - Full Width */}
                      {gameModes.filter(mode => mode.tier === 'dream').map((mode) => {
                        const lobby = lobbies.find(l => l.tier === mode.tier);
                        const minPlayers = lobby?.min || 10;
                        
                        return (
                          <motion.div
                            key={mode.tier}
                            whileHover={{ scale: 1.02, y: -4 }}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`relative p-8 bg-gradient-to-br ${
                              lobby?.status === 'playing' 
                                ? 'from-purple-900/60 to-indigo-900/60 border-purple-500/50 hover:border-purple-400' 
                                : 'from-purple-900/60 to-pink-900/60 border-purple-500/50 hover:border-purple-400'
                            } border-2 rounded-3xl backdrop-blur-sm transition-all cursor-pointer shadow-2xl overflow-hidden group`}
                            onClick={() => {
                              if (lobby?.status === 'playing') {
                                localStorage.setItem('spectateMode', 'true');
                                localStorage.setItem('selectedTier', mode.tier);
                                router.push('/game');
                              } else {
                                handleJoinGame(mode.tier);
                              }
                            }}
                          >
                            <div className={`absolute inset-0 bg-gradient-to-br ${
                              lobby?.status === 'playing' 
                                ? 'from-purple-500/0 to-indigo-500/0 group-hover:from-purple-500/10 group-hover:to-indigo-500/10' 
                                : 'from-purple-500/0 to-pink-500/0 group-hover:from-purple-500/10 group-hover:to-pink-500/10'
                            } transition-all`} />
                            <div className="relative z-10 grid md:grid-cols-2 gap-6 items-center">
                              {/* Left Side - Main Info */}
                              <div>
                                <div className="flex items-center gap-4 mb-4">
                                  <div className="text-7xl">💎</div>
                                  <div>
                                    <h3 className="text-4xl font-black text-purple-200">{mode.name}</h3>
                                    <p className="text-purple-400 text-sm">Hourly free tournament</p>
                                  </div>
                                </div>
                                <div className="text-5xl font-black text-purple-400 mb-4">FREE</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/20 border border-purple-400/30 rounded-lg">
                                    <span className="text-purple-300 text-sm">
                                      <span className="font-bold">Mass:</span> 1x  
                                      <span className="mx-2">|</span>
                                      <span className="font-bold">Speed:</span> +0%
                                    </span>
                                  </div>
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 border border-red-400/40 rounded-lg">
                                    <span className="text-lg">🎁</span>
                                    <span className="text-green-400 text-xs font-bold">10%</span>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Right Side - Stats Grid */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="bg-black/40 rounded-xl p-4">
                                  <div className="text-xs text-purple-400/70 mb-1">Players</div>
                                  <div className="text-2xl font-black text-white">{lobby?.realPlayerCount || 0}/{mode.maxPlayers}</div>
                                </div>
                                <div className="bg-black/40 rounded-xl p-4">
                                  <div className="text-xs text-purple-400/70 mb-1">Needs to Start</div>
                                  <div className="text-2xl font-black text-yellow-400">{minPlayers} players</div>
                                </div>
                                {lobby?.spectatorCount !== undefined && (
                                  <div className="bg-black/40 rounded-xl p-4">
                                    <div className="text-xs text-purple-400/70 mb-1">Spectators</div>
                                    <div className="text-2xl font-black text-blue-400">{lobby.spectatorCount} 👥</div>
                                  </div>
                                )}
                                {lobby?.countdown !== null && lobby?.countdown !== undefined && lobby.countdown > 0 ? (
                                  <div className="bg-orange-900/50 rounded-xl p-4 animate-pulse border border-orange-500/50">
                                    <div className="text-xs text-orange-300/70 mb-1">Starting In</div>
                                    <div className="text-2xl font-black text-orange-300">⏰ {lobby.countdown}s</div>
                                  </div>
                                ) : lobby?.status === 'playing' ? (
                                  <div className="bg-red-900/50 rounded-xl p-4 border border-red-500/50">
                                    <div className="text-xs text-red-300/70 mb-1">Status</div>
                                    <div className="text-xl font-black text-red-300 flex items-center gap-2">
                                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                      LIVE
                                    </div>
                                  </div>
                                ) : (
                                  <div className="bg-black/40 rounded-xl p-4">
                                    <div className="text-xs text-purple-400/70 mb-1">Prize Pool</div>
                                    <div className="text-2xl font-black text-green-400">$1.00</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                      
                      {/* Paid Tiers - 3 Column Grid */}
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {gameModes.filter(mode => mode.tier !== 'dream' && !mode.locked).map((mode, index) => {
                          const lobby = lobbies.find(l => l.tier === mode.tier);
                          const minPlayers = lobby?.min || 10;
                          
                          return (
                            <motion.div
                              key={mode.tier}
                              whileHover={{ scale: 1.05, y: -8 }}
                              initial={{ opacity: 0, y: 40 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.1 }}
                              className={`relative p-6 bg-gradient-to-br ${
                                lobby?.status === 'playing' 
                                  ? 'from-purple-900/50 to-indigo-900/50 border-purple-700/50 hover:border-purple-500' 
                                  : 'from-green-900/50 to-emerald-900/50 border-green-700/50 hover:border-green-500'
                              } border-2 rounded-2xl backdrop-blur-sm transition-all cursor-pointer shadow-xl overflow-hidden group`}
                              onClick={() => {
                                if (lobby?.status === 'playing') {
                                  setSelectedMode('spectate');
                                } else {
                                  handleJoinGame(mode.tier);
                                }
                              }}
                            >
                              <div className={`absolute inset-0 bg-gradient-to-br ${
                                lobby?.status === 'playing' 
                                  ? 'from-purple-500/0 to-indigo-500/0 group-hover:from-purple-500/10 group-hover:to-indigo-500/10' 
                                  : 'from-lime-500/0 to-green-500/0 group-hover:from-lime-500/10 group-hover:to-green-500/10'
                              } transition-all`} />
                              <div className="relative z-10">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-5xl">🐍</div>
                                  {lobby?.status === 'playing' && (
                                    <div className="flex items-center gap-1 text-xs bg-red-900/50 px-2 py-1 rounded-full border border-red-500/50">
                                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                                      <span className="text-red-300 font-bold">LIVE</span>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Title & Price */}
                                <h3 className="text-xl font-black text-white mb-2">{mode.name}</h3>
                                <div className="text-3xl font-black text-green-400 mb-3">${mode.buyIn.toFixed(2)}</div>
                                
                                {/* Stat Multipliers Badge */}
                                <div className="mb-4 flex flex-wrap items-center gap-2">
                                  <div className="inline-flex items-center gap-2 px-3 py-2 bg-yellow-500/20 border border-yellow-400/40 rounded-lg">
                                    <span className="text-yellow-300 text-xs">
                                      <span className="font-bold">Mass:</span> {mode.statMultiplier}x  
                                      <span className="mx-1.5">|</span>
                                      <span className="font-bold">Speed:</span> +{(((mode.statMultiplier || 1) - 1) * 10).toFixed(0)}%
                                    </span>
                                  </div>
                                  <div className="inline-flex items-center gap-1.5 px-2 py-1.5 bg-red-500/20 border border-red-400/40 rounded-lg">
                                    <span className="text-base">🎁</span>
                                    <span className="text-green-400 text-xs font-bold">100%</span>
                                  </div>
                                </div>
                                
                                {/* Stats */}
                                <div className="space-y-2 text-xs mb-4">
                                  <div className="flex justify-between items-center p-2 bg-black/30 rounded-lg">
                                    <span className="text-emerald-400/70">Players:</span>
                                    <span className="text-white font-bold">{lobby?.realPlayerCount || 0}/{mode.maxPlayers}</span>
                                  </div>
                                  <div className="flex justify-between items-center p-2 bg-black/30 rounded-lg">
                                    <span className="text-emerald-400/70">Needs:</span>
                                    <span className="text-yellow-400 font-bold">{minPlayers} to start</span>
                                  </div>
                                  {lobby?.spectatorCount !== undefined && lobby.spectatorCount > 0 && (
                                    <div className="flex justify-between items-center p-2 bg-black/30 rounded-lg">
                                      <span className="text-emerald-400/70">Watching:</span>
                                      <span className="text-blue-400 font-bold">{lobby.spectatorCount} 👥</span>
                                    </div>
                                  )}
                                  {lobby?.potSize && lobby.potSize > 0 && (
                                    <div className="text-green-400 font-bold text-center py-2 bg-green-900/30 rounded-lg">
                                      💰 Pot: ${lobby.potSize.toFixed(2)}
                                    </div>
                                  )}
                                  {lobby?.countdown !== null && lobby?.countdown !== undefined && lobby.countdown > 0 && (
                                    <div className="text-orange-400 font-bold text-center py-2 bg-orange-900/30 rounded-lg animate-pulse">
                                      ⏰ Starts in {lobby.countdown}s
                                    </div>
                                  )}
                                </div>
                                
                                {/* Enter Button */}
                                {lobby?.status === 'playing' ? (
                                  <motion.div
                                    className="py-3 px-4 bg-purple-500/30 text-purple-300 rounded-xl font-bold text-center cursor-pointer"
                                    whileHover={{ backgroundColor: 'rgba(168, 85, 247, 0.5)' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedMode('spectate');
                                    }}
                                  >
                                    🔭 Spectate →
                                  </motion.div>
                                ) : (
                                  <motion.div
                                    className="py-3 px-4 bg-green-500/30 text-green-300 rounded-xl font-bold text-center"
                                    whileHover={{ backgroundColor: 'rgba(34, 197, 94, 0.5)' }}
                                  >
                                    ⚔️ Enter Battle →
                                  </motion.div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
      )}
              </motion.div>
          )}

          {/* Spectate Mode: Observatory */}
          {selectedMode === 'spectate' && (
              <motion.div
              key="spectate-mode"
              initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
            >
              <div className="flex items-center gap-4 mb-8">
                <button
                  onClick={() => setSelectedMode(null)}
                  className="p-3 hover:bg-purple-900/50 rounded-xl transition-colors border border-purple-700/30"
                >
                  <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                    <div>
                  <div className="flex items-center gap-3">
                    <span className="text-5xl">🔭</span>
                    <h2 className="text-5xl font-black text-purple-300">Observatory</h2>
                    </div>
                  <p className="text-indigo-400/70 mt-2">Watch live battles from the canopy</p>
                    </div>
                  </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {lobbies.filter(l => l.status === 'playing').map((lobby, index) => (
              <motion.div
                    key={lobby.tier}
                    whileHover={{ scale: 1.05, y: -8 }}
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="group relative p-6 bg-gradient-to-br from-purple-900/40 via-blue-900/40 to-indigo-900/40 border-2 border-purple-600/40 rounded-2xl backdrop-blur-sm hover:border-purple-400 transition-all cursor-pointer shadow-xl overflow-hidden"
                    onClick={() => {
                      localStorage.setItem('spectateMode', 'true');
                      localStorage.setItem('selectedTier', lobby.tier);
                      router.push('/game');
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-blue-500/0 group-hover:from-purple-500/20 group-hover:to-blue-500/20 transition-all" />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-4xl">👁️</span>
                        <span className="flex items-center gap-1 text-xs bg-red-900/50 px-3 py-1.5 rounded-full border border-red-500/50">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-red-300 font-bold">LIVE</span>
                      </span>
                    </div>
                      <h3 className="text-2xl font-black text-white mb-4">
                        {gameModes.find(m => m.tier === lobby.tier)?.name || lobby.tier}
                      </h3>
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex justify-between items-center p-2 bg-black/30 rounded-lg">
                          <span className="text-indigo-400/70">Battling:</span>
                          <span className="text-white font-bold">{lobby.realPlayerCount + (lobby.botCount || 0)}</span>
                  </div>
                        <div className="flex justify-between items-center p-2 bg-black/30 rounded-lg">
                          <span className="text-indigo-400/70">Watching:</span>
                          <span className="text-purple-400 font-bold">{lobby.spectatorCount || 0} 👥</span>
                  </div>
                </div>
              <motion.div
                        className="py-3 px-4 bg-purple-500/30 rounded-xl text-purple-300 font-bold text-center"
                        whileHover={{ backgroundColor: 'rgba(168, 85, 247, 0.5)' }}
                      >
                        🔭 Watch Battle →
              </motion.div>
                    </div>
                  </motion.div>
                ))}
                {lobbies.filter(l => l.status === 'playing').length === 0 && (
                  <div className="col-span-full text-center py-20 bg-purple-900/20 rounded-3xl border-2 border-purple-700/30">
                    <div className="text-7xl mb-4">🌙</div>
                    <h3 className="text-2xl font-bold text-purple-300 mb-2">The Jungle Sleeps</h3>
                    <p className="text-indigo-400/70">No active battles right now. Return soon!</p>
                  </div>
                )}
                </div>
              </motion.div>
          )}
        </AnimatePresence>
        </div>

      {/* Modals */}
      <AuthModal
        isOpen={showAuthModal}
        onSign={handleAuthSign}
        onCancel={handleAuthCancel}
        isLoading={isAuthenticating}
        error={authError}
        challengeMessage={authChallenge?.message}
      />
      
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        walletAddress={walletAddress}
        appleBalance={appleBalance}
        onAppleBalanceUpdate={setAppleBalance}
      />

      {/* Countdown Warning Modal */}
      {showCountdownWarning && pendingJoinTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative w-full max-w-md bg-gradient-to-br from-orange-950 via-yellow-900 to-orange-950 rounded-3xl border-2 border-orange-600/50 shadow-2xl overflow-hidden p-6"
          >
            <div className="text-center">
              <div className="text-7xl mb-4">⚠️</div>
              <h3 className="text-2xl font-black text-orange-300 mb-3">Game Starting Soon!</h3>
              <p className="text-orange-200 mb-6">
                This game is about to start. If you join now, you'll be joining mid-countdown.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowCountdownWarning(false);
                    setPendingJoinTier(null);
                  }}
                  className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowCountdownWarning(false);
                    const gameMode = gameModes.find(m => m.tier === pendingJoinTier);
                    if (gameMode) {
                      await handlePaymentAndJoin(pendingJoinTier!, gameMode.buyIn, sessionToken);
                    }
                    setPendingJoinTier(null);
                  }}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-600 hover:opacity-90 text-white rounded-xl font-bold transition"
                >
                  Join Anyway
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Toast Notification - Jungle themed */}
      <AnimatePresence>
        {toastMessage && (
            <motion.div
            initial={{ opacity: 0, y: 50, x: 50 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 50, x: 50 }}
            className="fixed bottom-8 right-8 bg-gradient-to-r from-green-900 to-emerald-900 border-2 border-green-500/50 rounded-xl px-6 py-4 shadow-2xl z-50 max-w-md"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">🐍</span>
              <p className="text-white font-medium">{toastMessage}</p>
              </div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Transaction Log Modal */}
      <TransactionLog
        isOpen={showTransactionLog}
        onClose={() => setShowTransactionLog(false)}
      />

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowLeaderboard(false)}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-gradient-to-br from-green-950 via-emerald-900 to-green-950 rounded-2xl border-2 border-green-700/50 shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-green-700 to-emerald-700 px-6 py-4 flex items-center justify-between border-b border-green-600/50">
              <h2 className="text-2xl font-black text-white flex items-center gap-3">
                <span className="text-3xl">🏆</span>
                Top 50 Winners
              </h2>
              <button
                onClick={() => setShowLeaderboard(false)}
                className="text-white/70 hover:text-white transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)] bg-gradient-to-b from-green-950/50 to-emerald-950/50">
              <Leaderboard />
            </div>
          </motion.div>
        </div>
      )}

      {/* Chat Bubble */}
      <motion.button
        onClick={() => setShowChat(true)}
        className="fixed bottom-4 md:bottom-6 right-4 md:right-6 z-40 w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-green-600 to-emerald-600 rounded-full shadow-2xl flex items-center justify-center hover:from-green-500 hover:to-emerald-500 transition-all"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <svg className="w-6 h-6 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {chatMessages.length > 0 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold text-white">
            {chatMessages.length > 9 ? '9+' : chatMessages.length}
          </div>
        )}
      </motion.button>

      {/* Chat Modal */}
      {showChat && (
        <div 
          className="fixed inset-0 z-50 flex items-end md:items-end md:justify-end p-2 md:p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowChat(false)}
        >
          <motion.div 
            className="w-full md:max-w-md bg-gradient-to-br from-green-950 via-emerald-900 to-green-950 backdrop-blur-xl border-2 border-green-700/50 rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-green-700 to-emerald-700 px-4 py-3 flex items-center justify-between">
              <h3 className="text-white font-bold text-base md:text-lg flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Jungle Chat
              </h3>
              <button onClick={() => setShowChat(false)} className="p-1 hover:bg-white/20 rounded transition-colors">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="h-[350px] overflow-y-auto p-4 space-y-2 bg-black/30">
              {chatMessages.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p>Be the first to chat!</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className="bg-green-900/30 rounded-lg p-3 border border-green-700/30">
                    <span className="text-green-400 font-bold text-sm">{msg.username}:</span>{' '}
                    <span className="text-gray-200 text-sm">{msg.message}</span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 bg-green-950/50 border-t border-green-700/30">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder={connected && playerName.trim() ? "Type a message..." : "Connect wallet to chat..."}
                  disabled={!connected || !playerName.trim()}
                  className="flex-1 px-3 py-2 bg-green-950 border border-green-700 rounded-lg focus:outline-none focus:border-green-500 text-white text-sm placeholder-gray-500 disabled:opacity-50"
                  maxLength={200}
                />
                <motion.button
                  onClick={sendChatMessage}
                  disabled={!connected || !playerName.trim() || !chatInput.trim()}
                  className="px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-lg font-bold text-sm disabled:opacity-50 transition-all"
                  whileHover={{ scale: connected && playerName.trim() && chatInput.trim() ? 1.05 : 1 }}
                >
                  Send
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Sticky Footer - Contract Address */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-r from-green-900/95 via-emerald-900/95 to-green-900/95 backdrop-blur-lg border-t border-green-700/50 shadow-2xl"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs md:text-sm">
            <span className="text-green-400 font-bold">$SnekFi CA:</span>
            <code className="bg-green-950/50 px-3 py-1.5 rounded border border-green-700/50 text-green-300 font-mono text-xs">
              {CONTRACT_ADDRESS.slice(0, 8)}...{CONTRACT_ADDRESS.slice(-6)}
            </code>
          </div>
          <button
            onClick={copyToClipboard}
            className="px-4 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Full Address
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
