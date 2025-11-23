'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { motion } from 'framer-motion';

interface SnakeSegment {
  x: number;
  y: number;
}

interface Snake {
  id: string;
  playerId: string;
  segments: SnakeSegment[];
  angle: number;
  length: number;
  color: string;
  isBoosting: boolean;
  name: string;
}

interface Pellet {
  x: number;
  y: number;
  color?: string;
}

interface KillAnimation {
  blobId: string;
  victimX: number;
  victimY: number;
  startTime: number;
}

interface LeaderboardEntry {
  id: string;
  name: string;
  length: number; // Changed from mass
  cellsEaten: number;
  rank: number;
}

interface PlayerStats {
  pelletsEaten: number;
  cellsEaten: number;
  maxLength: number; // Changed from maxMass
  leaderTime: number;
  bestRank: number;
  timeSurvived: number;
}

interface GameEndResult {
  winnerId: string | null;
  finalRankings: Array<{
    id: string;
    name: string;
    length: number; // Changed from mass
    timeSurvived: number;
    cellsEaten: number;
  }>;
  playerStats: Record<string, PlayerStats>;
}

export default function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [snakes, setSnakes] = useState<Snake[]>([]);
  const [pellets, setPellets] = useState<Pellet[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameEnd, setGameEnd] = useState<GameEndResult | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [gameId, setGameId] = useState<string>('');
  const [camera, setCamera] = useState({ x: 2500, y: 2500, zoom: 1 });
  
  // Camera smoothing - stores the target camera position from server
  const targetCameraRef = useRef({ x: 2500, y: 2500, zoom: 1 });
  const smoothCameraRef = useRef({ x: 2500, y: 2500, zoom: 1 });
  
  // Entity interpolation - stores server positions and interpolated render positions
  const serverSnakesRef = useRef<Snake[]>([]);
  const interpolatedSnakesRef = useRef<Snake[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [lobbyStatus, setLobbyStatus] = useState({ players: 1, realPlayers: 1, max: 25, min: 10, countdown: null as number | null });
  const [isSpectating, setIsSpectating] = useState(false);
  const [spectatingPlayerId, setSpectatingPlayerId] = useState<string>('');
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [leaderboardVisible, setLeaderboardVisible] = useState(true);
  const [killAnimations, setKillAnimations] = useState<KillAnimation[]>([]);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'info' | 'error' | 'success' | 'warning' } | null>(null);
  const [mapBounds, setMapBounds] = useState<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const [boundaryWarning, setBoundaryWarning] = useState<{ startTime: number } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [winnerPayout, setWinnerPayout] = useState<{ amount: number; txSignature: string | null } | null>(null);
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickBase, setJoystickBase] = useState({ x: 0, y: 0 });
  const [joystickHandle, setJoystickHandle] = useState({ x: 0, y: 0 });
  const [minimapHidden, setMinimapHidden] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [gameModes, setGameModes] = useState<Array<{ tier: string; buyIn: number; name: string }>>([]);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; username: string; message: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [isBoosting, setIsBoosting] = useState(false);

  // Ensure component only renders on client side
  useEffect(() => {
    setMounted(true);
  }, []);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch username and chat history from DB on mount
  useEffect(() => {
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    
    // Load username
    const walletAddress = localStorage.getItem('playerWallet');
    if (walletAddress) {
      fetch(`${serverUrl}/api/user/${walletAddress}`)
        .then(res => res.json())
        .then(data => {
          if (data.user && data.user.username) {
            setCurrentUsername(data.user.username);
          }
        })
        .catch(console.error);
    }
    
    // Load chat history
    fetch(`${serverUrl}/api/chat`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && Array.isArray(data.messages)) {
          // Take last 100 messages
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

  const mousePosRef = useRef({ x: 2500, y: 2500 });
  const mouseScreenPosRef = useRef({ x: 0, y: 0 });
  const joystickPositionRef = useRef({ x: 0, y: 0 });
  const lastMovementDirectionRef = useRef({ x: 0, y: 0 }); // For split/eject on mobile
  const gameIdRef = useRef<string>('');
  const playerIdRef = useRef<string>('');
  const gameStartedRef = useRef<boolean>(false);
  const cameraRef = useRef(camera);
  const autoRedirectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMobileRef = useRef(false);

  // Update camera ref when camera changes
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  // Detect mobile on mount (use ref to avoid re-renders)
  useEffect(() => {
    isMobileRef.current = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);
  
  // Fetch game modes for accurate pot calculations
  useEffect(() => {
    const fetchGameModes = async () => {
      try {
        const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const response = await fetch(`${serverUrl}/api/game-modes`);
        const data = await response.json();
        setGameModes(data.modes || []);
      } catch (error) {
        console.error('Failed to fetch game modes:', error);
      }
    };
    fetchGameModes();
  }, []);
  
  // For rendering purposes (doesn't trigger camera updates)
  const isMobile = isMobileRef.current;

  useEffect(() => {
    const playerId = localStorage.getItem('playerId');
    const playerName = localStorage.getItem('playerName');
    const tier = localStorage.getItem('selectedTier');
    const walletAddress = localStorage.getItem('playerWallet');
    const existingGameId = localStorage.getItem('currentGameId');
    const spectateMode = localStorage.getItem('spectateMode');

    // Game page initialization

    // DON'T clear spectate flag yet - need it for socket connection
    const isSpectator = spectateMode === 'true';

    if (isSpectator) {
      // Joining as spectator
      console.log('🎥 SPECTATOR MODE ACTIVE - tier:', tier);
      if (!tier) {
        console.error('❌ No tier selected for spectating, redirecting');
        router.push('/');
        return;
      }
      // Set spectating immediately
      setIsSpectating(true);
    } else {
      // Joining as player
      console.log('🎮 PLAYER MODE - playerId:', playerId);
      if (!playerId || !playerName || !tier) {
        console.error('❌ Missing player credentials, redirecting');
        router.push('/');
        return;
      }
      setMyPlayerId(playerId);
      playerIdRef.current = playerId;
    }

    // Connect to Socket.io
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
    console.log('🔌 Connecting to Socket.io server:', serverUrl);
    const socket = io(serverUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ Socket connected! ID:', socket.id);
      
      if (isSpectator) {
        // Join as spectator
        console.log('🎥 Emitting joinAsSpectator event for tier:', tier);
        socket.emit('joinAsSpectator', { tier });
        // Now clear the flag
        localStorage.removeItem('spectateMode');
      } else if (existingGameId) {
        // Try to reconnect to existing game
        console.log('Attempting to reconnect to game:', existingGameId);
        socket.emit('playerReconnect', { playerId, gameId: existingGameId });
      } else {
        // Join lobby using x402-verified lobby token
        const lobbyToken = localStorage.getItem('lobbyToken');
        
        if (!lobbyToken) {
          console.error('❌ No lobby token found - redirecting to homepage');
          router.push('/');
          return;
        }
        
        console.log('🎟️  Joining lobby with verified token');
        
        socket.emit('playerJoinLobby', { 
          lobbyToken
        });
        
        // Clear lobby token after use (one-time)
        localStorage.removeItem('lobbyToken');
        localStorage.removeItem('entryPaymentTx'); // Clean up old field
      }
    });

    socket.on('spectatorJoined', ({ gameId, tier: joinedTier }) => {
      console.log('✅ Successfully joined as spectator for game:', gameId);
      setGameId(gameId);
      gameIdRef.current = gameId;
      setGameStarted(true);
      gameStartedRef.current = true;
      setIsSpectating(true);
      
      // Join the game room to receive updates
      socket.emit('join', gameId);
      console.log('Spectator joined room:', gameId);
      
      // Note: spectatingPlayerId will be set when first gameState arrives
    });

    socket.on('lobbyJoined', ({ lobbyId, tier: joinedTier }) => {
      console.log('Joined lobby:', lobbyId);
      setGameId(lobbyId);
      gameIdRef.current = lobbyId;
      socket.emit('join', lobbyId);
      socket.emit('requestLobbyStatus', { lobbyId });
    });

    socket.on('lobbyError', ({ message }) => {
      alert(`Unable to join: ${message}`);
      // Redirect back to homepage
      router.push('/');
    });

    socket.on('refundProcessed', ({ amount, tx }) => {
      alert(`✅ Refund processed: $${amount} USDC sent back to your wallet`);
    });

    socket.on('refundFailed', ({ error }) => {
      alert(`⚠️ Refund failed: ${error}. Please contact support.`);
    });

    // Listen for payout transaction signature from server
    socket.on('payoutReceived', ({ amount, txSignature }) => {
      setWinnerPayout({
        amount,
        txSignature
      });
    });

    socket.on('lobbyUpdate', ({ tier, playersLocked, realPlayerCount, maxPlayers, minPlayers, countdown, status }) => {
      const currentTier = localStorage.getItem('selectedTier');
      if (tier === currentTier) {
        setLobbyStatus({ 
          players: playersLocked, 
          realPlayers: realPlayerCount || playersLocked, // Use real player count for calculations
          max: maxPlayers, 
          min: minPlayers || 10, 
          countdown 
        });
      }
    });

    socket.on('reconnected', ({ gameId: reconnectedGameId }) => {
      console.log('Reconnected to game:', reconnectedGameId);
      setGameId(reconnectedGameId);
      gameIdRef.current = reconnectedGameId;
      setGameStarted(true);
      gameStartedRef.current = true;
      socket.emit('join', reconnectedGameId);
    });

    socket.on('gameNotFound', () => {
      console.log('Game not found, redirecting to lobby NOW');
      socket.disconnect();
      localStorage.clear();
      // Immediate redirect
      window.location.href = '/';
    });

    socket.on('serverShutdown', ({ message }) => {
      console.log('Server shutdown, redirecting to lobby NOW');
      socket.disconnect();
      localStorage.clear();
      // Immediate redirect
      window.location.href = '/';
    });

    socket.on('lobbyCancelled', ({ message }) => {
      console.log('Lobby cancelled, redirecting to lobby NOW');
      socket.disconnect();
      localStorage.clear();
      // Immediate redirect
      window.location.href = '/';
    });

    socket.on('gameStart', ({ startTime, gameId: startedGameId }) => {
      console.log('Game starting!');
      const finalGameId = startedGameId || gameIdRef.current;
      setGameId(finalGameId);
      gameIdRef.current = finalGameId;
      setGameStarted(true);
      gameStartedRef.current = true;
      localStorage.setItem('currentGameId', finalGameId);
    });

    socket.on('boundaryWarning', ({ startTime }) => {
      console.log('⚠️ BOUNDARY WARNING - 3 second countdown!');
      setBoundaryWarning({ startTime });
    });

    socket.on('boundarySafe', () => {
      console.log('✅ Moved away from boundary');
      setBoundaryWarning(null);
    });

    socket.on('boundaryKilled', () => {
      console.log('💀 Killed by boundary!');
      setBoundaryWarning(null);
    });

    socket.on('playerEliminated', ({ killerId, killerName }) => {
      console.log(`💀 YOU DIED!`);
      
      setIsSpectating(true);
      // Don't set spectatingPlayerId here - let auto-select choose leader
      setBoundaryWarning(null);
      playerIdRef.current = '';
      
      if (socketRef.current && gameIdRef.current) {
        socketRef.current.emit('becomeSpectator', { 
          playerId: myPlayerId,
          gameId: gameIdRef.current 
        });
      }
      
      console.log('✅ Spectator mode active');
    });

    // Player elimination broadcast (for all players to see)
    socket.on('playerEliminatedBroadcast', ({ victimName, killerName, remainingPlayers }) => {
      // Shorten names if needed for mobile
      const shortVictim = victimName.length > 12 ? victimName.substring(0, 12) + '...' : victimName;
      const shortKiller = killerName.length > 12 ? killerName.substring(0, 12) + '...' : killerName;
      
      if (killerName === 'Boundary') {
        setToastMessage({ 
          message: `${shortVictim} out (${remainingPlayers} left)`, 
          type: 'warning' 
        });
      } else {
        setToastMessage({ 
          message: `${shortVictim} ← ${shortKiller} (${remainingPlayers} left)`, 
          type: 'info' 
        });
      }
    });

    // Global chat messages
    socket.on('chatMessage', (msg: { username: string; message: string }) => {
      setChatMessages(prev => {
        const newMessages = [...prev, {
        id: Date.now().toString(),
        username: msg.username,
          message: msg.message,
          timestamp: Date.now()
        }];
        // Keep only the most recent 100 messages
        return newMessages.slice(-100);
      });
    });

    // Server tells us when a snake kills another
    socket.on('snakeKilled', ({ killerSnakeId, victimSnakeId, victimX, victimY }) => {
      const now = Date.now();
      
      // Killer gets sun rays animation
      setKillAnimations(prev => [...prev, {
        blobId: killerSnakeId, // Keep as blobId for animation compat
        victimX,
        victimY,
        startTime: now,
      }]);
    });

    socket.on('gameState', ({ snakes: newSnakes, pellets: newPellets, leaderboard: newLeaderboard, spectatorCount: specCount, mapBounds: newMapBounds, timeRemaining: timeLeft }) => {
      // Store server snakes for interpolation
      serverSnakesRef.current = newSnakes;
      
      // Initialize interpolated snakes if empty
      if (interpolatedSnakesRef.current.length === 0) {
        interpolatedSnakesRef.current = JSON.parse(JSON.stringify(newSnakes));
      }
      
      setSnakes(newSnakes);
      setPellets(newPellets);
      setLeaderboard(newLeaderboard);
      if (specCount !== undefined) {
        setSpectatorCount(specCount);
      }
      if (newMapBounds) {
        setMapBounds(newMapBounds);
      }
      if (timeLeft !== undefined) {
        setTimeRemaining(timeLeft);
      }

      // Check if player is dead (only if not already spectating)
      if (!isSpectating && playerId) {
        const mySnake = newSnakes.find((s: Snake) => s.playerId === playerId);
        if (!mySnake || mySnake.segments.length === 0 && gameStartedRef.current) {
          // Player died but didn't get elimination event - spectate leader
          setIsSpectating(true);
          if (newLeaderboard.length > 0) {
            setSpectatingPlayerId(newLeaderboard[0].id);
          }
        }
      }

      // ONLY auto-select if we don't have anyone selected
      if (isSpectating && !spectatingPlayerId && newLeaderboard.length > 0) {
        const leader = newLeaderboard[0];
        console.log('👁️ AUTO-SELECTING leader:', leader.name, leader.id);
        setSpectatingPlayerId(leader.id);
      }

      // Check if current spectated player is still alive
      if (isSpectating && spectatingPlayerId) {
        const current = newLeaderboard.find((p: LeaderboardEntry) => p.id === spectatingPlayerId);
        const currentSnake = newSnakes.find((s: Snake) => s.playerId === spectatingPlayerId);
        
        console.log(`📊 Current spectate: ${spectatingPlayerId}, Found in leaderboard: ${!!current}, Has snake: ${!!currentSnake}`);
        
        // ONLY auto-switch if player is confirmed dead
        if (!current || current.length === 0 || !currentSnake) {
          const alivePlayers = newLeaderboard.filter((p: LeaderboardEntry) => p.length > 0);
          if (alivePlayers.length > 0) {
            console.log(`⚠️ ${spectatingPlayerId} is DEAD, switching to ${alivePlayers[0].name}`);
            setSpectatingPlayerId(alivePlayers[0].id);
          }
        }
      }

      // Camera update for non-spectators (playing mode)
      if (!isSpectating && playerId) {
        const mySnake = newSnakes.find((s: Snake) => s.playerId === playerId);
        if (mySnake && mySnake.segments.length > 0) {
          const head = mySnake.segments[0];
          const length = mySnake.length;
          
          let zoom = Math.max(0.2, Math.min(1.5, 200 / Math.sqrt(length * 10)));
          
          // Platform-specific zoom adjustments
          if (isMobileRef.current) {
            // Mobile: zoom out 2x
            zoom = zoom * 0.5;
          } else {
            // Desktop: zoom out 1.5x
            zoom = zoom * 0.67;
          }
          
          // Set target camera position (will be smoothed in render loop)
          targetCameraRef.current = { x: head.x, y: head.y, zoom };
        }
      }
      // Spectator camera update handled by separate useEffect
    });

    socket.on('gameEnd', (result: GameEndResult) => {
      setGameEnd(result);
      
      const isWinner = result.winnerId === playerId;
      
      // Payout amount will be set via 'payoutReceived' event from server
      
      // Clear any existing timer
      if (autoRedirectTimerRef.current) {
        clearTimeout(autoRedirectTimerRef.current);
      }
      
      // Only auto-redirect NON-winners (losers and spectators)
      if (!isWinner) {
        autoRedirectTimerRef.current = setTimeout(() => {
          localStorage.clear();
          window.location.href = '/';
        }, 10000);
      }
    });

    socket.on('error', ({ message }) => {
      console.error('❌ Server error:', message);
      
      // Don't redirect if we're trying to spectate - show toast instead
      if (spectateMode === 'true') {
        setToastMessage({ message: `Cannot spectate: ${message}`, type: 'error' });
        console.log('Spectate failed, staying on page to show error');
        return;
      }
      socket.disconnect();
      localStorage.clear();
      // Immediate redirect for non-spectator errors
      window.location.href = '/';
    });

    return () => {
      console.log('🔌 Disconnecting socket and cleaning up');
      
      // Clear auto-redirect timer if it exists
      if (autoRedirectTimerRef.current) {
        clearTimeout(autoRedirectTimerRef.current);
        autoRedirectTimerRef.current = null;
      }
      
      // Remove from spectators if we were spectating
      if (isSpectating && gameIdRef.current) {
        socket.emit('leaveSpectate', { gameId: gameIdRef.current });
      }
      
      socket.disconnect();
    };
  }, [router]);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Auto-scroll chat to bottom only when opening chat
  useEffect(() => {
    if (showChat) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [showChat]);

  // SPECTATOR CAMERA LOCK - Smoothly interpolates to follow spectated player
  useEffect(() => {
    if (!isSpectating || !spectatingPlayerId || snakes.length === 0) return;

    const targetSnake = snakes.find(s => s.playerId === spectatingPlayerId);
    
    if (targetSnake && targetSnake.segments.length > 0) {
      const head = targetSnake.segments[0];
      const length = targetSnake.length;
      let zoom = Math.max(0.2, Math.min(1.5, 200 / Math.sqrt(length * 10)));
      
      // Zoom out 2x for all platforms
      zoom = zoom * 0.5;
      
      // Smooth camera movement with lerp (linear interpolation) - reduces jitter
      const currentCam = cameraRef.current;
      const lerp = 0.15; // Smoothing factor (lower = smoother but slower)
      
      const smoothX = currentCam.x + (head.x - currentCam.x) * lerp;
      const smoothY = currentCam.y + (head.y - currentCam.y) * lerp;
      const smoothZoom = currentCam.zoom + (zoom - currentCam.zoom) * lerp;
      
      setCamera({ x: smoothX, y: smoothY, zoom: smoothZoom });
    }
  }, [snakes, isSpectating, spectatingPlayerId]);

  // Update mouse screen position on move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      
      mouseScreenPosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Movement system
  useEffect(() => {
    const interval = setInterval(() => {
      const socket = socketRef.current;
      const canvas = canvasRef.current;
      
      if (!isSpectating && gameStartedRef.current && socket?.connected && gameIdRef.current && playerIdRef.current && canvas) {
        const cam = cameraRef.current;
        
        let worldX, worldY;
        let shouldMove = false;
        
        // Mobile joystick movement
        if (isMobileRef.current) {
          if (joystickActive) {
            const pos = joystickPositionRef.current;
            const directionX = pos.x; // Already normalized
            const directionY = pos.y;
            
            worldX = cam.x + directionX * 1000;
            worldY = cam.y + directionY * 1000;
            
            // Store last direction for split/eject
            lastMovementDirectionRef.current = { x: directionX, y: directionY };
            shouldMove = true;
          }
        } else {
          // Desktop mouse movement (always active)
        const screenPos = mouseScreenPosRef.current;
        
          worldX = cam.x + (screenPos.x - canvas.width / 2) / cam.zoom;
          worldY = cam.y + (screenPos.y - canvas.height / 2) / cam.zoom;
        
          // Calculate direction vector for split/eject
          const dirX = screenPos.x - canvas.width / 2;
          const dirY = screenPos.y - canvas.height / 2;
          const magnitude = Math.sqrt(dirX * dirX + dirY * dirY);
          if (magnitude > 0) {
            lastMovementDirectionRef.current = { x: dirX / magnitude, y: dirY / magnitude };
          }
          shouldMove = true;
        }
        
        // Only emit movement if we should move
        if (shouldMove) {
        socket.emit('playerMove', {
          playerId: playerIdRef.current,
          x: worldX,
          y: worldY,
          gameId: gameIdRef.current,
        });
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isSpectating, joystickActive]);

  // Handle keyboard controls
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Spectator controls - cycle through players (ALWAYS available when spectating)
      if (isSpectating) {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          e.preventDefault();
          console.log('⌨️ Arrow key pressed, isSpectating:', isSpectating, 'spectatingPlayerId:', spectatingPlayerId);
          
          const alivePlayers = leaderboard.filter(p => p.length > 0);
          console.log(`Found ${alivePlayers.length} alive players to spectate`);
          
          if (alivePlayers.length === 0) {
            console.log('❌ No alive players to switch to');
            return;
          }
          
          const currentIndex = alivePlayers.findIndex(p => p.id === spectatingPlayerId);
          console.log(`Current spectating index: ${currentIndex}`);
          
          let newIndex;
          if (e.code === 'ArrowRight') {
            newIndex = (currentIndex + 1) % alivePlayers.length;
          } else {
            newIndex = (currentIndex - 1 + alivePlayers.length) % alivePlayers.length;
          }
          
          const newPlayer = alivePlayers[newIndex];
          console.log(`✅ MANUAL SWITCH via keyboard to ${newPlayer.name} (${newPlayer.id})`);
          console.log(`   Previous: ${spectatingPlayerId}, New: ${newPlayer.id}`);
          setSpectatingPlayerId(newPlayer.id);
        }
        return; // Don't process game controls if spectating
      }

      // Game controls (only if NOT spectating)

      if (!socketRef.current || !gameIdRef.current || !playerIdRef.current) return;
      if (!canvasRef.current) return;

      if (e.code === 'Space') {
        e.preventDefault();
        
        // Toggle boost on
        setIsBoosting(true);
        socketRef.current.emit('playerBoost', { 
          playerId: playerIdRef.current, 
          gameId: gameIdRef.current,
          boosting: true
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isSpectating) return;
      if (!socketRef.current || !gameIdRef.current || !playerIdRef.current) return;

      if (e.code === 'Space') {
        e.preventDefault();
        
        // Toggle boost off
        setIsBoosting(false);
        socketRef.current.emit('playerBoost', { 
          playerId: playerIdRef.current, 
          gameId: gameIdRef.current,
          boosting: false
        });
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpectating, spectatingPlayerId, leaderboard, snakes]);

  // Canvas rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let animationFrameId: number;

    const render = () => {
      // Smooth camera interpolation (for non-spectators)
      if (!isSpectating) {
        const lerpFactor = 0.15; // Smoothing factor (0.1-0.2 is good)
        smoothCameraRef.current.x += (targetCameraRef.current.x - smoothCameraRef.current.x) * lerpFactor;
        smoothCameraRef.current.y += (targetCameraRef.current.y - smoothCameraRef.current.y) * lerpFactor;
        smoothCameraRef.current.zoom += (targetCameraRef.current.zoom - smoothCameraRef.current.zoom) * lerpFactor;
        
        // Update camera state with smoothed values
        setCamera({ 
          x: smoothCameraRef.current.x, 
          y: smoothCameraRef.current.y, 
          zoom: smoothCameraRef.current.zoom 
        });
      }
      
      // Smooth entity interpolation for snakes
      const entityLerpFactor = 0.25; // Slightly faster than camera for responsiveness
      
      for (let i = 0; i < serverSnakesRef.current.length; i++) {
        const serverSnake = serverSnakesRef.current[i];
        let interpolatedSnake = interpolatedSnakesRef.current.find(s => s.id === serverSnake.id);
        
        if (!interpolatedSnake) {
          // New snake - add it with server position
          interpolatedSnakesRef.current.push(JSON.parse(JSON.stringify(serverSnake)));
        } else {
          // Interpolate existing snake segments
          for (let j = 0; j < serverSnake.segments.length && j < interpolatedSnake.segments.length; j++) {
            interpolatedSnake.segments[j].x += (serverSnake.segments[j].x - interpolatedSnake.segments[j].x) * entityLerpFactor;
            interpolatedSnake.segments[j].y += (serverSnake.segments[j].y - interpolatedSnake.segments[j].y) * entityLerpFactor;
          }
          
          // Update other properties directly (no interpolation needed)
          interpolatedSnake.angle = serverSnake.angle;
          interpolatedSnake.length = serverSnake.length;
          interpolatedSnake.isBoosting = serverSnake.isBoosting;
          interpolatedSnake.color = serverSnake.color;
          interpolatedSnake.name = serverSnake.name;
        }
      }
      
      // Remove snakes that no longer exist on server
      interpolatedSnakesRef.current = interpolatedSnakesRef.current.filter(
        interpSnake => serverSnakesRef.current.some(serverSnake => serverSnake.id === interpSnake.id)
      );
      
      // Clear canvas with dark theme
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Save context
      ctx.save();

      // Apply camera transform
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(camera.zoom, camera.zoom);
      ctx.translate(-camera.x, -camera.y);

      // Draw grid (subtle)
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1 / camera.zoom;
      for (let x = 0; x <= 5000; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 5000);
        ctx.stroke();
      }
      for (let y = 0; y <= 5000; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(5000, y);
        ctx.stroke();
      }

      // Draw shrinking map boundaries (red danger zone outside)
      if (mapBounds && (mapBounds.minX > 0 || mapBounds.maxX < 5000 || mapBounds.minY > 0 || mapBounds.maxY < 5000)) {
        // Red tint for danger zone
        ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
        
        // Left danger zone
        if (mapBounds.minX > 0) {
          ctx.fillRect(0, 0, mapBounds.minX, 5000);
        }
        // Right danger zone
        if (mapBounds.maxX < 5000) {
          ctx.fillRect(mapBounds.maxX, 0, 5000 - mapBounds.maxX, 5000);
        }
        // Top danger zone
        if (mapBounds.minY > 0) {
          ctx.fillRect(mapBounds.minX, 0, mapBounds.maxX - mapBounds.minX, mapBounds.minY);
        }
        // Bottom danger zone
        if (mapBounds.maxY < 5000) {
          ctx.fillRect(mapBounds.minX, mapBounds.maxY, mapBounds.maxX - mapBounds.minX, 5000 - mapBounds.maxY);
        }
        
        // Draw boundary lines
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 6 / camera.zoom;
        ctx.setLineDash([]);
        ctx.strokeRect(mapBounds.minX, mapBounds.minY, mapBounds.maxX - mapBounds.minX, mapBounds.maxY - mapBounds.minY);
      }

      // Draw pellets as diamonds
      pellets.forEach(pellet => {
        const pelletSize = 3; // Reduced to 50% of previous size
        
        ctx.fillStyle = pellet.color || '#4ECDC4';
        ctx.beginPath();
        ctx.moveTo(pellet.x, pellet.y - pelletSize); // Top
        ctx.lineTo(pellet.x + pelletSize, pellet.y); // Right
        ctx.lineTo(pellet.x, pellet.y + pelletSize); // Bottom
        ctx.lineTo(pellet.x - pelletSize, pellet.y); // Left
        ctx.closePath();
        ctx.fill();
        
        // Add slight glow with pellet's color
        ctx.strokeStyle = pellet.color || '#4ECDC4';
        ctx.lineWidth = 0.5 / camera.zoom;
        ctx.stroke();
      });

      const now = Date.now();
      
      // Filter animations locally - don't call setState in render loop!
      const activeKillAnimations = killAnimations.filter(a => now - a.startTime < 400);

      // Use interpolated snakes for smooth rendering
      const snakesToRender = interpolatedSnakesRef.current.length > 0 ? interpolatedSnakesRef.current : snakes;
      
      // Sort snakes by length (smallest to largest) so bigger snakes render on top
      const sortedSnakes = [...snakesToRender].sort((a, b) => a.length - b.length);

      // Draw snakes
      sortedSnakes.forEach(snake => {
        if (!snake.segments || snake.segments.length === 0) return;

        const segmentRadius = 10;
        const headRadius = 15;
        
        // Check for kill animation (sun rays + glow)
        const killAnim = activeKillAnimations.find(a => a.blobId === snake.id);
        
        // Draw body segments (connected circles)
        for (let i = snake.segments.length - 1; i >= 0; i--) {
          const seg = snake.segments[i];
          const radius = i === 0 ? headRadius : segmentRadius;
          
          ctx.fillStyle = snake.color;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
          ctx.fill();
          
          // Draw border for segments
          ctx.strokeStyle = snake.playerId === myPlayerId ? '#FFD700' : (isSpectating && snake.playerId === spectatingPlayerId ? '#4ECDC4' : 'rgba(0,0,0,0.3)');
          ctx.lineWidth = 2 / camera.zoom;
          ctx.stroke();
        }
        
        // Draw head (slightly larger with eyes)
        const head = snake.segments[0];
        
        // Add boost glow if boosting
        if (snake.isBoosting) {
          ctx.save();
          ctx.shadowColor = snake.color;
          ctx.shadowBlur = 20;
          ctx.strokeStyle = snake.color;
          ctx.lineWidth = 4 / camera.zoom;
          ctx.beginPath();
          ctx.arc(head.x, head.y, headRadius + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        
        // Draw eyes on head
        const eyeOffset = 8;
        const eyeRadius = 4;
        const angle = snake.angle || 0;
        
        // Left eye
        const leftEyeX = head.x + Math.cos(angle - Math.PI / 6) * eyeOffset;
        const leftEyeY = head.y + Math.sin(angle - Math.PI / 6) * eyeOffset;
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Right eye
        const rightEyeX = head.x + Math.cos(angle + Math.PI / 6) * eyeOffset;
        const rightEyeY = head.y + Math.sin(angle + Math.PI / 6) * eyeOffset;
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Kill animation - sun rays
        if (killAnim) {
          const elapsed = now - killAnim.startTime;
          const progress = Math.min(1, elapsed / 400);
          
          // Fade in then fade out
          let alpha;
          if (progress < 0.2) {
            alpha = progress / 0.2;
          } else {
            alpha = 1 - ((progress - 0.2) / 0.8);
          }
          
          // Draw 8 clean neon sun rays with gap from head
          ctx.save();
          ctx.globalAlpha = alpha * 0.9;
          ctx.shadowBlur = 10 / camera.zoom;
          ctx.shadowColor = '#39FF14';
          ctx.strokeStyle = '#39FF14';
          ctx.lineWidth = 2 / camera.zoom;
          ctx.lineCap = 'round';
          
          for (let i = 0; i < 8; i++) {
            const rayAngle = (i / 8) * Math.PI * 2;
            const rayStart = headRadius * 1.25;
            const rayEnd = headRadius * 1.65;
            
            ctx.beginPath();
            ctx.moveTo(
              head.x + Math.cos(rayAngle) * rayStart,
              head.y + Math.sin(rayAngle) * rayStart
            );
            ctx.lineTo(
              head.x + Math.cos(rayAngle) * rayEnd,
              head.y + Math.sin(rayAngle) * rayEnd
            );
            ctx.stroke();
          }
          
          ctx.restore();
        }

        // Draw player name
        const player = leaderboard.find(p => p.id === snake.playerId);
        if (player) {
          ctx.fillStyle = '#fff';
          ctx.font = `${Math.max(12, 14 / camera.zoom)}px Arial`;
          ctx.textAlign = 'center';
          ctx.fillText(player.name, head.x, head.y + headRadius + 20 / camera.zoom);
        }
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [snakes, pellets, killAnimations, leaderboard, myPlayerId, isSpectating, spectatingPlayerId]);

  // Cleanup old animations periodically (separate from render loop)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setKillAnimations(prev => prev.filter(a => now - a.startTime < 400));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Handle back button / ESC to leave lobby or close chat - MUST BE BEFORE EARLY RETURNS
  useEffect(() => {
    if (!gameStarted) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (showChat) {
            setShowChat(false);
          } else {
            leaveLobby();
          }
        } else if (e.key === 'Backspace' && !showChat) {
          leaveLobby();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [gameStarted, showChat, router]);

  // Function to leave lobby - MUST BE BEFORE EARLY RETURNS
  const leaveLobby = () => {
    // Can't leave if countdown started (pot locked)
    if (lobbyStatus.countdown !== null && lobbyStatus.countdown > 0) {
      return; // Blocked - no refunds
    }
    
    const playerId = localStorage.getItem('playerId');
    
    if (socketRef.current && playerId) {
      // Notify server we're leaving
      socketRef.current.emit('playerLeaveLobby', { playerId });
      
      // Small delay to let server process
      setTimeout(() => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
        localStorage.clear();
        router.push('/');
      }, 100);
    } else {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      localStorage.clear();
      router.push('/');
    }
  };

  if (gameEnd) {
    const myStats = gameEnd.playerStats[myPlayerId];
    const myRanking = gameEnd.finalRankings.findIndex(r => r.id === myPlayerId) + 1;
    const isWinner = gameEnd.winnerId === myPlayerId;

    // Confetti pieces (simple, clean)
    const confettiPieces = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 2 + Math.random() * 2,
      color: ['#39FF14', '#00F0FF', '#BC13FE', '#FFD700'][Math.floor(Math.random() * 4)]
    }));

    // Generate share tweet
    const generateTweet = () => {
      const stats = myStats || { pelletsEaten: 0, cellsEaten: 0, maxLength: 0, timeSurvived: 0 };
      
      // Use calculated payout amount (already set in gameEnd handler)
      const payoutAmount = winnerPayout?.amount || 1;
      
      const solscanLink = winnerPayout?.txSignature 
        ? `\nhttps://solscan.io/tx/${winnerPayout.txSignature}`
        : '';
      
      const tweetText = isWinner
        ? `🏆 Just won $${payoutAmount} USDC on @slitherfi_dev!\n\n` +
          `📊 Stats:\n` +
          `• Rank: #${myRanking}\n` +
          `• Food Eaten: ${stats.pelletsEaten}\n` +
          `• Snakes Eaten: ${stats.cellsEaten}\n` +
          `• Max Length: ${stats.maxLength}\n` +
          `• Survived: ${Math.floor(stats.timeSurvived)}s\n\n` +
          `Play SlitherFi 👉 https://slitherfi.io\n` +
          `Join community: https://x.com/i/communities/1989932677966041578${solscanLink}\n\n` +
          `@osknyo_dev`
        : `Just played @slitherfi_dev - ranked #${myRanking}!\n\n` +
          `📊 ${stats.pelletsEaten} food • ${stats.cellsEaten} snakes • ${stats.maxLength} length\n\n` +
          `Free to play, winners earn USDC 💰\n` +
          `https://slitherfi.io\n\n` +
          `@osknyo_dev`;
      
      const encodedTweet = encodeURIComponent(tweetText);
      window.open(`https://twitter.com/intent/tweet?text=${encodedTweet}`, '_blank');
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-cyber-darker to-cyber-dark flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
        {/* Confetti (Winners Only) */}
        {isWinner && (
          <div className="fixed inset-0 pointer-events-none overflow-hidden">
            {confettiPieces.map(piece => (
              <motion.div
                key={piece.id}
                initial={{ y: -20, x: `${piece.left}vw`, opacity: 1, rotate: 0 }}
                animate={{ 
                  y: '110vh',
                  rotate: 360 * 3,
                  opacity: [1, 1, 0.5, 0]
                }}
                transition={{
                  duration: piece.duration,
                  delay: piece.delay,
                  ease: 'linear'
                }}
                className="absolute w-2 h-2 md:w-3 md:h-3"
                style={{ 
                  backgroundColor: piece.color,
                  left: 0
                }}
              />
            ))}
          </div>
        )}

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', duration: 0.6 }}
          className="max-w-2xl w-full bg-cyber-dark/50 backdrop-blur-lg border border-neon-green/30 rounded-2xl p-6 md:p-8 relative z-10"
        >
          {/* Floating Trophy (Winners Only) */}
          {isWinner && (
            <motion.div
              initial={{ y: -100, scale: 0 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ type: 'spring', bounce: 0.5, duration: 1 }}
              className="absolute -top-12 md:-top-16 left-1/2 -translate-x-1/2 text-6xl md:text-8xl"
            >
              <motion.div
                animate={{ 
                  y: [0, -10, 0],
                  rotate: [0, 5, 0, -5, 0]
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
              >
                🏆
              </motion.div>
            </motion.div>
          )}

          <h2 className="text-3xl md:text-4xl font-black text-center mb-4 md:mb-6 mt-4">
            {isWinner ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.3 }}
              >
              <span className="gradient-text text-glow">
                  VICTORY!
              </span>
              </motion.div>
            ) : (
              <span className="text-white">Game Over</span>
            )}
          </h2>

          {/* Winner Payout Banner */}
          {isWinner && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="bg-gradient-to-r from-neon-green/20 to-neon-blue/20 border-2 border-neon-green/50 rounded-xl p-4 md:p-6 mb-6 text-center"
            >
              <div className="text-4xl md:text-5xl font-black text-neon-green mb-2">
                +${winnerPayout?.amount || 1} USDC
              </div>
              <div className="text-sm text-gray-400 mb-3">
                {winnerPayout?.txSignature ? '✅ Sent to your wallet' : '⏳ Processing payout...'}
              </div>
              {winnerPayout?.txSignature && (
                <a
                  href={`https://solscan.io/tx/${winnerPayout.txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs text-neon-blue hover:text-neon-green transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View on Solscan
                </a>
              )}
            </motion.div>
          )}

          <div className="text-center mb-6 md:mb-8">
            <div className="text-5xl md:text-6xl font-black text-neon-green mb-2">
              #{myRanking}
            </div>
            <div className="text-gray-400">Final Placement</div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-cyber-darker rounded-lg p-4 border border-neon-green/30">
              <div className="text-sm text-gray-400">Food Eaten</div>
              <div className="text-2xl font-bold text-neon-green">{myStats?.pelletsEaten || 0}</div>
            </div>
            <div className="bg-cyber-darker rounded-lg p-4 border border-neon-pink/30">
              <div className="text-sm text-gray-400">Cells Eaten</div>
              <div className="text-2xl font-bold text-neon-pink">{myStats?.cellsEaten || 0}</div>
            </div>
            <div className="bg-cyber-darker rounded-lg p-4 border border-neon-blue/30">
              <div className="text-sm text-gray-400">Max Length</div>
              <div className="text-2xl font-bold text-neon-blue">{myStats?.maxLength || 0}</div>
            </div>
            <div className="bg-cyber-darker rounded-lg p-4 border border-neon-purple/30">
              <div className="text-sm text-gray-400">Time Survived</div>
              <div className="text-2xl font-bold text-neon-purple">
                {Math.floor(myStats?.timeSurvived || 0)}s
              </div>
            </div>
            <div className="bg-cyber-darker rounded-lg p-4 border border-neon-green/30">
              <div className="text-sm text-gray-400">Leader Time</div>
              <div className="text-2xl font-bold text-neon-green">
                {Math.floor(myStats?.leaderTime || 0)}s
              </div>
            </div>
            <div className="bg-cyber-darker rounded-lg p-4 border border-neon-pink/30">
              <div className="text-sm text-gray-400">Best Rank</div>
              <div className="text-2xl font-bold text-neon-pink">
                #{myStats?.bestRank === 999 ? '-' : myStats?.bestRank}
              </div>
            </div>
          </div>

          {/* Final Rankings */}
          <div className="mb-8">
            <h3 className="text-xl font-bold mb-4 text-neon-green">Final Rankings</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {gameEnd.finalRankings.map((player, index) => (
                <div
                  key={player.id}
                  className={`flex justify-between items-center p-3 rounded ${
                    player.id === myPlayerId ? 'bg-neon-green/20 border border-neon-green/50' : 'bg-cyber-darker border border-neon-green/10'
                  }`}
                >
                  <span className="font-bold">#{index + 1} {player.name}</span>
                  <span className="text-gray-400">
                    {player.length} length • {player.cellsEaten} kills
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Share on X Button */}
          {isWinner && (
            <motion.button
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.7 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={generateTweet}
              className="w-full py-4 md:py-5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-xl font-bold text-white transition-all mb-4 flex items-center justify-center gap-2 text-base md:text-lg shadow-lg"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share Win on 𝕏
              <span className="text-xl">🚀</span>
            </motion.button>
          )}

          <motion.button
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: isWinner ? 0.9 : 0.3 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              console.log('Return to lobby clicked (game end)');
              
              // Clear auto-redirect timer
              if (autoRedirectTimerRef.current) {
                clearTimeout(autoRedirectTimerRef.current);
                autoRedirectTimerRef.current = null;
              }
              
              if (socketRef.current) {
                socketRef.current.disconnect();
              }
              localStorage.clear();
              window.location.href = '/';
            }}
            className="w-full py-4 bg-gradient-to-r from-neon-green to-neon-blue hover:from-neon-green hover:to-neon-blue rounded-lg font-bold text-black transition-all"
          >
            Return to Lobby
          </motion.button>
          {!isWinner && (
          <p className="text-xs text-gray-500 text-center mt-3">
            Auto-redirecting in a few seconds...
          </p>
          )}
        </motion.div>
      </div>
    );
  }

  // Show lobby waiting screen if game hasn't started
  if (!gameStarted) {
    const generateLobbyTweet = () => {
      // Calculate actual winner amount based on tier
      let rewardAmount = '1';
      if (typeof window !== 'undefined') {
        const tier = localStorage.getItem('selectedTier');
        if (tier === 'dream') {
          rewardAmount = process.env.NEXT_PUBLIC_DREAM_PAYOUT || '1';
        } else if (tier) {
          const entryFee = parseInt(tier);
          const realPlayers = lobbyStatus.realPlayers || 1;
          rewardAmount = (entryFee * realPlayers * 0.80).toFixed(2);
        }
      }
      
      const tweetText = `🐍 Join my SlitherFi battle NOW!\n\n` +
        `💰 Winner gets $${rewardAmount} USDC\n` +
        `👥 ${lobbyStatus.players}/${lobbyStatus.max} players\n` +
        `🔥 Compete for real prizes in the jungle!\n\n` +
        `Join before it fills up 👇\n` +
        `https://slitherfi.io\n\n` +
        `@osknyo_dev @slitherfi_dev`;
      
      const encodedTweet = encodeURIComponent(tweetText);
      window.open(`https://twitter.com/intent/tweet?text=${encodedTweet}`, '_blank');
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-cyber-darker to-cyber-dark flex items-center justify-center p-4 md:p-8">
        <div className="max-w-md w-full bg-cyber-dark/50 backdrop-blur-lg border border-neon-green/30 rounded-2xl p-6 md:p-8 text-center">
          <div className="mb-6">
            <div className="text-6xl mb-4">⏳</div>
            <h2 className="text-3xl font-bold text-white mb-2">Waiting for Game</h2>
            <p className="text-gray-400">Get ready to play!</p>
          </div>

          {/* Winner Reward Banner */}
          <div className="bg-gradient-to-r from-neon-green/20 to-neon-blue/20 border border-neon-green/50 rounded-xl p-4 mb-6">
            <div className="text-2xl font-black text-neon-green mb-1">
              💰 Winner Gets ${(() => {
                if (typeof window === 'undefined') return '1.00';
                const tier = localStorage.getItem('selectedTier');
                if (tier === 'dream') {
                  return parseInt(process.env.NEXT_PUBLIC_DREAM_PAYOUT || '1').toFixed(2);
                } else if (tier) {
                  // Get ACTUAL entry fee from game modes (not from tier string!)
                  const gameMode = gameModes.find(m => m.tier === tier);
                  const entryFee = gameMode?.buyIn || 0;
                  const realPlayers = lobbyStatus.realPlayers || 1;
                  return (entryFee * realPlayers * 0.80).toFixed(2);
                }
                return '1.00';
              })()} USDC
            </div>
            <div className="text-xs text-gray-400">
              {(() => {
                if (typeof window === 'undefined') return 'Loading...';
                const tier = localStorage.getItem('selectedTier');
                if (tier === 'dream') {
                  return 'Free hourly game - Winner takes all';
                } else {
                  const realPlayers = lobbyStatus.realPlayers || 1;
                  const botCount = (lobbyStatus.players || 1) - realPlayers;
                  return `80% of pot (${realPlayers} paid player${realPlayers !== 1 ? 's' : ''}${botCount > 0 ? ` + ${botCount} bot${botCount > 1 ? 's' : ''}` : ''})`;
                }
              })()}
            </div>
          </div>

          <div className="bg-cyber-darker rounded-lg p-6 mb-6 border border-neon-green/30">
            <div className="text-4xl font-black text-neon-green mb-2">
              {lobbyStatus.players}/{lobbyStatus.max}
            </div>
            <div className="text-sm text-gray-400">Players in Lobby</div>
          </div>

          {lobbyStatus.countdown !== null && lobbyStatus.countdown > 0 && (
            <div className="bg-red-500/20 border-2 border-red-500/50 rounded-lg p-4 mb-6">
              <div className="text-2xl font-bold text-red-400 mb-2">
                Starting in {lobbyStatus.countdown}s
              </div>
              <div className="text-xs text-white/80 font-bold mb-2">Countdown timer is to allow for more players to join the game!</div>
              <div className="text-sm font-bold text-red-300">🔒 POT LOCKED - No Refunds!</div>
              <div className="text-xs text-gray-400 mt-1">Entry fee is non-refundable</div>
            </div>
          )}

          {lobbyStatus.players < lobbyStatus.min && (
            <div className="bg-neon-blue/20 border border-neon-blue/50 rounded-lg p-4 mb-4">
              <div className="text-sm text-neon-blue mb-3">
                Waiting for {lobbyStatus.min - lobbyStatus.players} more player(s)...
              </div>
              
              {/* Share on X Button */}
              <motion.button
                onClick={generateLobbyTweet}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share on 𝕏 - Get More Players!
                <span className="text-lg">📢</span>
              </motion.button>
            </div>
          )}

          {/* Leave Lobby Button */}
          {lobbyStatus.countdown !== null && lobbyStatus.countdown > 0 ? (
            <div className="w-full py-3 bg-gray-600/50 border border-gray-500/50 text-gray-400 rounded-xl font-bold text-center mb-4 cursor-not-allowed">
              🔒 Locked - No Refunds
            </div>
          ) : (
            <button
              onClick={leaveLobby}
              className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded-xl font-bold transition-all mb-4"
            >
              ← Leave Lobby & Get Refund
            </button>
          )}

          <div className="text-xs text-gray-500 text-center">
            {lobbyStatus.countdown !== null && lobbyStatus.countdown > 0 ? (
              <p className="text-red-400 font-bold">⚠️ No refunds after countdown starts</p>
            ) : (
              <p>Press <kbd className="px-2 py-0.5 bg-gray-700 rounded">ESC</kbd> or <kbd className="px-2 py-0.5 bg-gray-700 rounded">Backspace</kbd> to leave</p>
            )}
          </div>
        </div>

        {/* Chat Bubble */}
        <motion.button
          onClick={() => setShowChat(true)}
          className="fixed bottom-4 md:bottom-6 right-4 md:right-6 z-40 w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-neon-blue to-neon-purple rounded-full shadow-2xl flex items-center justify-center"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <svg className="w-6 h-6 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {chatMessages.length > 0 && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
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
              className="w-full md:max-w-md bg-cyber-dark/95 backdrop-blur-xl border-2 border-neon-blue/50 rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden"
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-neon-blue to-neon-purple px-4 py-3 flex items-center justify-between">
                <h3 className="text-white font-bold text-base md:text-lg">Global Chat</h3>
                <button onClick={() => setShowChat(false)} className="text-white/70 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="h-[350px] overflow-y-auto p-4 space-y-2 bg-cyber-darker/50">
                {chatMessages.length === 0 ? (
                  <div className="text-center py-16 text-gray-500 text-sm">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p>Be the first to chat!</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className="bg-cyber-dark/50 rounded-lg p-2 border border-neon-blue/20">
                      <span className="text-neon-green font-bold text-xs">{msg.username}:</span>{' '}
                      <span className="text-gray-300 text-xs">{msg.message}</span>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-3 bg-cyber-dark border-t border-neon-blue/30">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && chatInput.trim()) {
                        if (socketRef.current && typeof window !== 'undefined') {
                          socketRef.current.emit('chatMessage', {
                            username: currentUsername || 'Anonymous',
                            message: chatInput.trim(),
                            walletAddress: localStorage.getItem('playerWallet') || null
                          });
                        }
                        setChatInput('');
                      }
                    }}
                    placeholder="Type a message..."
                    className="flex-1 bg-cyber-darker border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue text-sm"
                  />
                  <button
                    onClick={() => {
                      if (chatInput.trim() && socketRef.current && typeof window !== 'undefined') {
                        socketRef.current.emit('chatMessage', {
                          username: currentUsername || 'Anonymous',
                          message: chatInput.trim(),
                          walletAddress: localStorage.getItem('playerWallet') || null
                        });
                        setChatInput('');
                      }
                    }}
                    className="px-6 py-3 bg-gradient-to-r from-neon-blue to-neon-purple rounded-lg text-white font-bold hover:opacity-90 transition-opacity text-sm"
                  >
                    Send
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  // Prevent SSR - only render on client
  if (!mounted) {
    return (
      <div className="relative w-screen h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  const myLength = snakes
    .find(s => s.playerId === myPlayerId)?.length || 0;

  return (
    <div className="relative w-screen h-screen bg-gray-900">
      <canvas ref={canvasRef} className="absolute inset-0" />
      
      {/* Spectator UI - Top Center */}
      {isSpectating && (() => {
        const spectatedPlayer = leaderboard.find(p => p.id === spectatingPlayerId);
        
        const switchPlayer = (direction: 'left' | 'right') => {
          const alivePlayers = leaderboard.filter(p => p.length > 0);
          if (alivePlayers.length === 0) return;
          
          const currentIndex = alivePlayers.findIndex(p => p.id === spectatingPlayerId);
          let newIndex;
          if (direction === 'right') {
            newIndex = (currentIndex + 1) % alivePlayers.length;
          } else {
            newIndex = (currentIndex - 1 + alivePlayers.length) % alivePlayers.length;
          }
          const newPlayer = alivePlayers[newIndex];
          console.log(`🔄 MANUAL SWITCH via button to ${newPlayer.name} (${newPlayer.id})`);
          console.log(`   Previous: ${spectatingPlayerId}, New: ${newPlayer.id}`);
          setSpectatingPlayerId(newPlayer.id);
        };
        
        // Show UI even if player not found yet (loading state)
        return (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex flex-col gap-3 z-50" style={{ pointerEvents: 'auto' }}>
            {/* Spectator Info Card */}
            <div className="flex items-center gap-2">
              {/* Previous Player Button */}
              <button
                onClick={() => switchPlayer('left')}
                onTouchStart={(e) => e.stopPropagation()}
                className="w-10 h-10 bg-gray-700/90 hover:bg-gray-600 backdrop-blur-md rounded-lg border border-gray-600 shadow-lg transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
                aria-label="Previous player"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              {/* Spectator Info */}
              <div className="bg-gray-800/90 backdrop-blur-md rounded-lg px-6 py-3 border border-gray-700 shadow-xl">
                <div className="text-center">
                  <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Spectating</div>
                  {spectatedPlayer ? (
                    <>
                      <div className="text-lg font-bold text-white">{spectatedPlayer.name}</div>
                      <div className="text-sm text-gray-400">{spectatedPlayer.length} length</div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400">Loading...</div>
                  )}
                  <div className="text-xs text-gray-500 mt-2 hidden md:block">← → to switch players</div>
                </div>
              </div>
              
              {/* Next Player Button */}
              <button
                onClick={() => switchPlayer('right')}
                onTouchStart={(e) => e.stopPropagation()}
                className="w-10 h-10 bg-gray-700/90 hover:bg-gray-600 backdrop-blur-md rounded-lg border border-gray-600 shadow-lg transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
                aria-label="Next player"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            {/* Return to Lobby Button */}
          <button
            onClick={() => {
              console.log('🏠 Return to lobby clicked (spectator mode)');
              console.log('Current gameId:', gameIdRef.current);
              console.log('Socket connected:', socketRef.current?.connected);
              
              // Emit leave spectate event and wait for server to process
              if (socketRef.current && gameIdRef.current) {
                console.log('📤 Emitting leaveSpectate for game:', gameIdRef.current);
                socketRef.current.emit('leaveSpectate', { gameId: gameIdRef.current });
                
                // Wait for server to process (200ms should be enough)
                setTimeout(() => {
                  console.log('⏱️ Delay complete, disconnecting socket');
                  if (socketRef.current) {
                    socketRef.current.disconnect();
                  }
                  localStorage.clear();
                  window.location.href = '/';
                }, 200);
              } else {
                console.warn('⚠️ No gameId or socket, disconnecting immediately');
                if (socketRef.current) {
                  socketRef.current.disconnect();
                }
                localStorage.clear();
                window.location.href = '/';
              }
            }}
            onTouchStart={(e) => e.stopPropagation()}
              className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-semibold px-6 py-3 rounded-lg shadow-lg border border-red-400/50 transition-all hover:scale-105 active:scale-95"
            >
              ← Return to Lobby
            </button>
          </div>
        );
      })()}

      {/* Leaderboard - Top Left (Mobile & Desktop) */}
      {leaderboardVisible && (
        <div className="absolute top-4 left-4 bg-gray-800/95 backdrop-blur-md rounded-xl border border-gray-700 shadow-xl overflow-hidden w-32 sm:w-40 md:w-56 z-40" style={{ pointerEvents: 'auto' }}>
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-3 md:px-4 py-1.5 md:py-2 flex justify-between items-center">
            <h3 className="text-white font-bold text-xs md:text-sm uppercase tracking-wide">Leaderboard</h3>
            <button
              onClick={() => setLeaderboardVisible(false)}
              onTouchStart={(e) => e.stopPropagation()}
              className="text-white/70 hover:text-white transition-colors"
              aria-label="Hide leaderboard"
            >
              <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-2 md:p-3 space-y-1 max-h-80 overflow-y-auto">
            {leaderboard.slice(0, 10).map((entry, index) => {
              const isMe = entry.id === myPlayerId;
              const isSpectated = entry.id === spectatingPlayerId;
              return (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between px-2 md:px-3 py-1.5 md:py-2 rounded-lg transition-all ${
                    isMe 
                      ? 'bg-yellow-500/20 border border-yellow-500/50' 
                      : isSpectated
                      ? 'bg-blue-500/20 border border-blue-500/50'
                      : 'bg-gray-700/30 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <span className={`text-xs md:text-sm font-bold ${
                      index === 0 ? 'text-yellow-400' : 
                      index === 1 ? 'text-gray-300' : 
                      index === 2 ? 'text-orange-400' : 
                      'text-gray-400'
                    }`}>
                      #{index + 1}
                    </span>
                    <span className={`text-xs md:text-sm truncate max-w-[50px] sm:max-w-[70px] md:max-w-[100px] ${
                      isMe ? 'text-yellow-400 font-bold' : 
                      isSpectated ? 'text-blue-400 font-bold' : 
                      'text-white'
                    }`}>
                      {entry.name}
                    </span>
                  </div>
                  <span className="text-xs md:text-sm font-semibold text-blue-400 flex-shrink-0">
                    {entry.length}
                  </span>
                </div>
              );
            })}
          </div>
          {spectatorCount > 0 && (
            <div className="px-3 md:px-4 py-1.5 md:py-2 bg-gray-900/50 border-t border-gray-700">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Spectators</span>
                <span className="text-blue-400 font-semibold">👁️ {spectatorCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Show Leaderboard Button (Mobile & Desktop) */}
      {!leaderboardVisible && (
        <button
          onClick={() => setLeaderboardVisible(true)}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute top-4 left-4 bg-gray-800/90 backdrop-blur-md rounded-lg px-3 md:px-4 py-2 border border-gray-700 shadow-xl hover:bg-gray-700 transition-colors z-40"
          style={{ pointerEvents: 'auto' }}
          aria-label="Show leaderboard"
        >
          <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* HUD Top Right - Mass & Timer */}
      <div className="absolute top-4 right-4 left-auto flex items-start gap-2 md:gap-3 z-40" style={{ pointerEvents: 'auto' }}>
        {/* Game Timer */}
        {timeRemaining !== null && (
          <div className="bg-gray-800/90 backdrop-blur-md rounded-xl border border-gray-700 shadow-xl px-3 md:px-5 py-2 md:py-3">
            <div className="text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Time Left</div>
              <div className="text-lg md:text-xl font-bold text-white">
                {Math.floor(timeRemaining / 60000)}:{String(Math.floor((timeRemaining % 60000) / 1000)).padStart(2, '0')}
              </div>
            </div>
          </div>
        )}

        {/* Length Counter */}
        {!isSpectating && myLength > 0 && (
          <div className="bg-gray-800/90 backdrop-blur-md rounded-xl border border-gray-700 shadow-xl px-3 md:px-5 py-2 md:py-3">
            <div className="text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Your Length</div>
              <div className="text-xl md:text-2xl font-black text-white">{myLength}</div>
            </div>
          </div>
        )}
      </div>

      {/* Boundary Warning */}
      {boundaryWarning && !isSpectating && (() => {
        const elapsed = Date.now() - boundaryWarning.startTime;
        const remaining = Math.max(0, 3 - Math.floor(elapsed / 1000));
        
        return (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="bg-red-600/90 backdrop-blur-md rounded-xl border-4 border-red-400 shadow-2xl px-12 py-8 animate-pulse">
              <div className="text-center">
                <div className="text-6xl font-black text-white mb-4">{remaining}</div>
                <div className="text-2xl font-bold text-white mb-2">⚠️ BOUNDARY WARNING ⚠️</div>
                <div className="text-lg text-white">Move away from edge or die!</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Minimap - Bottom Left (with hide button on mobile) */}
      {!minimapHidden && (
        <div className="absolute bottom-4 left-4 bg-gray-800/90 backdrop-blur-md rounded-xl border border-gray-700 shadow-xl overflow-hidden z-40" style={{ pointerEvents: 'auto' }}>
          <div className="bg-gradient-to-r from-gray-700 to-gray-800 px-3 py-1.5 border-b border-gray-600 flex justify-between items-center">
          <h4 className="text-white font-semibold text-xs uppercase tracking-wide">Map</h4>
            {isMobile && (
              <button
                onClick={() => setMinimapHidden(true)}
                onTouchStart={(e) => e.stopPropagation()}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
        </div>
        <div className="relative w-48 h-48 bg-gray-900 p-2">
          {snakes.map(snake => {
            if (!snake.segments || snake.segments.length === 0) return null;
            const head = snake.segments[0];
            const x = (head.x / 5000) * 192;
            const y = (head.y / 5000) * 192;
            const size = Math.max(3, Math.min(10, snake.length / 10));
            const isMe = snake.playerId === myPlayerId;
            const isSpectated = snake.playerId === spectatingPlayerId;
            
            return (
              <div
                key={snake.id}
                className="absolute rounded-full"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: isMe ? '#FFD700' : (isSpectated ? '#4ECDC4' : snake.color),
                  transform: 'translate(-50%, -50%)',
                  boxShadow: isMe ? '0 0 8px #FFD700' : isSpectated ? '0 0 8px #4ECDC4' : 'none',
                }}
              />
            );
          })}
          
          {/* Camera viewport indicator */}
          <div
            className="absolute border-2 border-white/30"
            style={{
              left: `${((camera.x - 400/camera.zoom) / 5000) * 192}px`,
              top: `${((camera.y - 300/camera.zoom) / 5000) * 192}px`,
              width: `${(800/camera.zoom / 5000) * 192}px`,
              height: `${(600/camera.zoom / 5000) * 192}px`,
            }}
          />
        </div>
      </div>
      )}

      {/* Show Minimap Button (Mobile Only, when hidden) */}
      {minimapHidden && isMobile && (
          <button
          onClick={() => setMinimapHidden(false)}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-4 bg-gray-800/90 backdrop-blur-md rounded-lg px-3 py-2 border border-gray-700 shadow-xl z-40"
          style={{ pointerEvents: 'auto' }}
        >
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </button>
      )}

      {/* Mobile Controls */}
      {!isSpectating && isMobile && (
        <>
          {/* Floating Joystick Zone - Full Screen */}
          <div
            className="absolute inset-0 md:hidden z-30"
            style={{ touchAction: 'none', pointerEvents: joystickActive ? 'auto' : 'auto' }}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              setJoystickBase({ x: touch.clientX, y: touch.clientY });
              setJoystickHandle({ x: touch.clientX, y: touch.clientY });
              setJoystickActive(true);
            }}
            onTouchMove={(e) => {
              if (!joystickActive) return;
              
              const touch = e.touches[0];
              const deltaX = touch.clientX - joystickBase.x;
              const deltaY = touch.clientY - joystickBase.y;
              
              const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
              const maxRadius = 60;
              
              let handleX = touch.clientX;
              let handleY = touch.clientY;
              
              if (distance > maxRadius) {
                handleX = joystickBase.x + (deltaX / distance) * maxRadius;
                handleY = joystickBase.y + (deltaY / distance) * maxRadius;
              }
              
              setJoystickHandle({ x: handleX, y: handleY });
              
              const normalizedX = (handleX - joystickBase.x) / maxRadius;
              const normalizedY = (handleY - joystickBase.y) / maxRadius;
              joystickPositionRef.current = { x: normalizedX, y: normalizedY };
              lastMovementDirectionRef.current = { x: normalizedX, y: normalizedY };
            }}
            onTouchEnd={() => {
              setJoystickActive(false);
              joystickPositionRef.current = { x: 0, y: 0 };
            }}
          />
          
          {/* Visual Joystick (appears dynamically) */}
          {joystickActive && (
            <>
              <div
                className="absolute w-32 h-32 rounded-full bg-gray-800/40 backdrop-blur-sm border-2 border-gray-600/50 pointer-events-none z-40"
                style={{
                  left: joystickBase.x - 64,
                  top: joystickBase.y - 64
                }}
              />
              <div
                className="absolute w-16 h-16 rounded-full bg-gradient-to-br from-neon-green to-neon-blue border-2 border-white/50 shadow-lg pointer-events-none z-40"
                style={{
                  left: joystickHandle.x - 32,
                  top: joystickHandle.y - 32
                }}
              />
            </>
          )}

          {/* Action Button - Bottom Right (High z-index to prevent click-through) */}
          <div className="absolute bottom-4 right-4 flex gap-3 md:hidden z-50" style={{ pointerEvents: 'auto' }}>
            <button
              onPointerDown={(e) => {
                e.stopPropagation(); // Don't let click propagate to joystick zone
                e.preventDefault();
                if (!socketRef.current) return;
                
                setIsBoosting(true);
                socketRef.current.emit('playerBoost', { 
                  playerId: playerIdRef.current, 
                  gameId: gameIdRef.current,
                  boosting: true
                });
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                if (!socketRef.current) return;
                
                setIsBoosting(false);
                socketRef.current.emit('playerBoost', { 
                  playerId: playerIdRef.current, 
                  gameId: gameIdRef.current,
                  boosting: false
                });
              }}
              className={`w-20 h-20 rounded-full font-bold text-white shadow-lg border-2 active:scale-95 transition-all ${
                isBoosting 
                  ? 'bg-gradient-to-br from-yellow-400 to-orange-500 border-yellow-300/50' 
                  : 'bg-gradient-to-br from-purple-500 to-indigo-600 border-purple-400/50'
              }`}
            >
              <div className="text-xs">🚀 BOOST</div>
            </button>
          </div>
        </>
      )}

      {/* Keyboard Controls Info - Desktop only */}
      {!isSpectating && (
        <div className="absolute bottom-4 right-4 bg-gray-800/90 backdrop-blur-md rounded-lg px-4 py-3 border border-gray-700 shadow-xl hidden md:block">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-gray-700 text-white rounded font-mono text-xs border border-gray-600">SPACE</kbd>
              <span className="text-gray-300">Boost (Hold)</span>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 md:top-4 md:left-auto md:right-4 md:translate-x-0 z-50 animate-slideIn px-4 md:px-0">
          <div className={`bg-gradient-to-r ${
            toastMessage.type === 'error' ? 'from-red-500 to-rose-600' :
            toastMessage.type === 'success' ? 'from-green-500 to-emerald-600' :
            toastMessage.type === 'warning' ? 'from-yellow-500 to-orange-500' :
            'from-blue-500 to-cyan-500'
          } text-white px-4 py-3 rounded-lg shadow-2xl border border-white/20 backdrop-blur-md`}>
            <p className="text-sm font-medium text-center md:text-left">{toastMessage.message}</p>
          </div>
        </div>
      )}

      {/* Chat Bubble - Only for Spectators with wallet */}
      {isSpectating && currentUsername && typeof window !== 'undefined' && localStorage.getItem('playerWallet') && (
        <motion.button
          onClick={() => setShowChat(true)}
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-neon-blue to-neon-purple rounded-full shadow-2xl flex items-center justify-center"
          style={{ pointerEvents: 'auto' }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <svg className="w-6 h-6 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {chatMessages.length > 0 && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
              {chatMessages.length > 9 ? '9+' : chatMessages.length}
            </div>
          )}
        </motion.button>
      )}

      {/* Chat Modal - Only for Spectators */}
      {showChat && isSpectating && (
        <div 
          className="fixed inset-0 z-50 flex items-end md:items-end md:justify-end p-2 md:p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowChat(false)}
          style={{ pointerEvents: 'auto' }}
        >
          <motion.div 
            className="w-full md:max-w-md bg-cyber-dark/95 backdrop-blur-xl border-2 border-neon-blue/50 rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-neon-blue to-neon-purple px-4 py-3 flex items-center justify-between">
              <h3 className="text-white font-bold text-base md:text-lg">Global Chat</h3>
              <button onClick={() => setShowChat(false)} className="text-white/70 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="h-[350px] overflow-y-auto p-4 space-y-2 bg-cyber-darker/50">
              {chatMessages.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p>Be the first to chat!</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className="bg-cyber-dark/50 rounded-lg p-2 border border-neon-blue/20">
                    <span className="text-neon-green font-bold text-xs">{msg.username}:</span>{' '}
                    <span className="text-gray-300 text-xs">{msg.message}</span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 bg-cyber-dark border-t border-neon-blue/30">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && chatInput.trim()) {
                      if (socketRef.current && typeof window !== 'undefined') {
                        socketRef.current.emit('chatMessage', {
                          username: currentUsername,
                          message: chatInput.trim(),
                          walletAddress: localStorage.getItem('playerWallet')
                        });
                      }
                      setChatInput('');
                    }
                  }}
                  placeholder="Type a message..."
                  className="flex-1 bg-cyber-darker border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue text-sm"
                />
                  <button
                    onClick={() => {
                      if (chatInput.trim() && socketRef.current && typeof window !== 'undefined') {
                        socketRef.current.emit('chatMessage', {
                          username: currentUsername,
                          message: chatInput.trim(),
                          walletAddress: localStorage.getItem('playerWallet')
                        });
                        setChatInput('');
                      }
                    }}
                  className="px-6 py-3 bg-gradient-to-r from-neon-blue to-neon-purple rounded-lg text-white font-bold hover:opacity-90 transition-opacity text-sm"
                >
                  Send
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
