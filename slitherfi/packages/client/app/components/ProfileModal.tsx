'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface UserProfile {
  walletAddress: string;
  username: string;
  totalWinnings: number;
  totalWagered?: number;
  gamesWon: number;
  gamesPlayed: number;
}

interface RecentGame {
  gameId: string;
  tier: string;
  timestamp: number;
  isWinner: boolean;
  winnerName: string;
  potAmount?: number;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string | null;
}

export function ProfileModal({ isOpen, onClose, walletAddress }: ProfileModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (isOpen && walletAddress) {
      fetchProfileData();
    }
  }, [isOpen, walletAddress]);

  const fetchProfileData = async () => {
    if (!walletAddress) return;
    
    setLoading(true);
    try {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      
      // Fetch user profile
      const profileRes = await fetch(`${serverUrl}/api/user/${walletAddress}`);
      const profileData = await profileRes.json();
      
      if (profileData.user) {
        setProfile(profileData.user);
        setNewName(profileData.user.username);
      }
      
      // Fetch recent games
      const gamesRes = await fetch(`${serverUrl}/api/user/${walletAddress}/games?limit=5`);
      const gamesData = await gamesRes.json();
      setRecentGames(gamesData.games || []);
      
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateName = async () => {
    if (!walletAddress || !newName.trim()) return;
    
    try {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      const res = await fetch(`${serverUrl}/api/user/update-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, username: newName.trim() })
      });
      
      if (res.ok) {
        setProfile(prev => prev ? { ...prev, username: newName.trim() } : null);
        setEditingName(false);
      }
    } catch (error) {
      console.error('Failed to update name:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        />
        
        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-2xl bg-gradient-to-br from-green-900/95 to-emerald-900/95 border-2 border-green-500/50 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-green-700/30">
            <div className="flex items-center gap-3">
              <span className="text-4xl">🎮</span>
              <h2 className="text-2xl font-black text-green-300">Adventurer Profile</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-green-800/50 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="text-center py-12 text-green-400">Loading...</div>
            ) : profile ? (
              <>
                {/* Name Section */}
                <div className="bg-black/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-emerald-400/70">Name</span>
                    {!editingName && (
                      <button
                        onClick={() => setEditingName(true)}
                        className="text-xs text-green-400 hover:text-green-300"
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                  {editingName ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="flex-1 px-3 py-2 bg-green-950/50 border border-green-700/30 rounded-lg text-white"
                        maxLength={20}
                      />
                      <button
                        onClick={handleUpdateName}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-bold"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingName(false);
                          setNewName(profile.username);
                        }}
                        className="px-4 py-2 bg-red-600/30 hover:bg-red-600/50 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <p className="text-xl font-bold text-white">{profile.username}</p>
                  )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-black/30 rounded-xl p-4">
                    <div className="text-sm text-emerald-400/70 mb-1">Total Wins</div>
                    <div className="text-2xl font-black text-yellow-400">{profile.gamesWon}</div>
                  </div>
                  <div className="bg-black/30 rounded-xl p-4">
                    <div className="text-sm text-emerald-400/70 mb-1">Games Played</div>
                    <div className="text-2xl font-black text-blue-400">{profile.gamesPlayed}</div>
                  </div>
                  <div className="bg-black/30 rounded-xl p-4">
                    <div className="text-sm text-emerald-400/70 mb-1">Total Earnings</div>
                    <div className="text-2xl font-black text-green-400">${(profile.totalWinnings || 0).toFixed(2)}</div>
                  </div>
                  <div className="bg-black/30 rounded-xl p-4">
                    <div className="text-sm text-emerald-400/70 mb-1">Total Wagered</div>
                    <div className="text-2xl font-black text-orange-400">${(profile.totalWagered || 0).toFixed(2)}</div>
                  </div>
                </div>

                {/* Wallet */}
                <div className="bg-black/30 rounded-xl p-4">
                  <div className="text-sm text-emerald-400/70 mb-1">Wallet Address</div>
                  <p className="text-sm font-mono text-white/70 break-all">{profile.walletAddress}</p>
                </div>

                {/* Recent Games */}
                <div>
                  <h3 className="text-lg font-bold text-green-300 mb-3">Recent Games</h3>
                  {recentGames.length === 0 ? (
                    <div className="text-center py-8 bg-black/30 rounded-xl text-emerald-400/70">
                      No games played yet
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recentGames.map((game) => (
                        <div
                          key={game.gameId}
                          className={`p-3 rounded-lg ${
                            game.isWinner
                              ? 'bg-yellow-900/30 border border-yellow-600/30'
                              : 'bg-black/30 border border-green-700/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {game.isWinner && <span className="text-xl">🏆</span>}
                              <span className="text-sm font-bold text-white capitalize">{game.tier}</span>
                              <span className="text-xs text-emerald-400/70">
                                {new Date(game.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="text-sm">
                              {game.isWinner ? (
                                <span className="text-yellow-400 font-bold">Winner</span>
                              ) : (
                                <span className="text-white/50">
                                  Won by {game.winnerName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-emerald-400/70">
                Profile not found
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

