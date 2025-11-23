'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePathname } from 'next/navigation';

export function GlobalChat() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  // Hide global chat on game page (it has its own chat)
  if (pathname === '/game') return null;

  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; username: string; message: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // Connect to socket only for chat
  useEffect(() => {
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('💬 Global chat socket connected');
    });

    socket.on('chatMessage', (msg: { username: string; message: string }) => {
      setChatMessages(prev => {
        const newMessages = [...prev, {
          id: Date.now().toString(),
          username: msg.username,
          message: msg.message
        }];
        return newMessages.slice(-100);
      });
    });

    socket.on('connect_error', (error) => {
      console.error('💬 Chat connection error:', error);
    });

    return () => {
      console.log('💬 Disconnecting global chat socket');
      socket.disconnect();
    };
  }, []);

  // Load username from API
  useEffect(() => {
    if (walletAddress) {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      fetch(`${serverUrl}/api/user/${walletAddress}`)
        .then(res => res.json())
        .then(data => {
          if (data.user && data.user.username) {
            setCurrentUsername(data.user.username);
          }
        })
        .catch(console.error);
    }
  }, [walletAddress]);

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
            message: msg.message
          }));
          setChatMessages(recentMessages);
        }
      })
      .catch(console.error);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (showChat) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [showChat, chatMessages]);

  const handleSendMessage = () => {
    if (chatInput.trim() && socketRef.current) {
      socketRef.current.emit('chatMessage', {
        username: currentUsername || 'Anonymous',
        message: chatInput.trim(),
        walletAddress: walletAddress || null
      });
      setChatInput('');
    }
  };

  return (
    <>
      {/* Chat Bubble */}
      <motion.button
        onClick={() => setShowChat(true)}
        className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-green-600 to-emerald-600 rounded-full shadow-2xl flex items-center justify-center hover:from-green-500 hover:to-emerald-500 transition-all"
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
                <span className="text-xl">💬</span>
                Jungle Chat
              </h3>
              <button onClick={() => setShowChat(false)} className="text-white/70 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type a message..."
                  className="flex-1 bg-green-950 border border-green-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                />
                <button
                  onClick={handleSendMessage}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg text-white font-bold transition-all text-sm"
                >
                  Send
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}

