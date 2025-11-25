'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SnakePreview } from './SnakePreview';

interface UserProfile {
  walletAddress: string;
  username: string;
  totalWinnings: number;
  totalWagered?: number;
  gamesWon: number;
  gamesPlayed: number;
  apples?: number;
  unlockedCosmetics?: string[];
  equippedCosmetics?: {
    trail?: string;
    headItem?: string;
    nameStyle?: string;
  };
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
  appleBalance?: number;
  onAppleBalanceUpdate?: (balance: number) => void;
}

export function ProfileModal({ isOpen, onClose, walletAddress, appleBalance = 0, onAppleBalanceUpdate }: ProfileModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [equippedCosmetics, setEquippedCosmetics] = useState<{ trail?: string; headItem?: string; nameStyle?: string }>({});
  const [unlockedCosmetics, setUnlockedCosmetics] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<'trail' | 'headItem' | 'nameStyle' | null>(null);
  const [allCosmetics, setAllCosmetics] = useState<any>(null);
  const [cosmeticsLoading, setCosmeticsLoading] = useState(false);
  const [cosmeticsError, setCosmeticsError] = useState(false);

  useEffect(() => {
    if (isOpen && walletAddress) {
      fetchProfileData();
      fetchAllCosmetics();
    }
  }, [isOpen, walletAddress]);

  const fetchAllCosmetics = async () => {
    if (cosmeticsLoading) return; // Prevent duplicate requests
    
    setCosmeticsLoading(true);
    setCosmeticsError(false);
    
    try {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      console.log('📦 Fetching cosmetics from:', `${serverUrl}/api/cosmetics`);
      
      const response = await fetch(`${serverUrl}/api/cosmetics`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('✅ ProfileModal received cosmetics:', data);
      
        setAllCosmetics(data);
      setCosmeticsLoading(false);
      setCosmeticsError(false);
    } catch (error) {
      console.error('❌ Failed to fetch cosmetics:', error);
      setCosmeticsLoading(false);
      setCosmeticsError(true);
    }
  };

  const handleEquip = async (cosmeticId: string, slot: 'trail' | 'headItem' | 'nameStyle') => {
    if (!walletAddress) return;

    try {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      console.log('📦 Equipping cosmetic via API:', { cosmeticId, slot });
      
      const response = await fetch(`${serverUrl}/api/cosmetics/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, cosmeticId, slot })
      });

      const result = await response.json();
        console.log('📦 Equip result received:', result);
      
        if (result.success) {
          setEquippedCosmetics(result.equippedCosmetics);
          
          // Also update profile state
          if (profile) {
            setProfile({
              ...profile,
              equippedCosmetics: result.equippedCosmetics
            });
          }
          
          setSelectedSlot(null);
          console.log('✅ Cosmetic equipped successfully');
        } else {
          console.error('❌ Failed to equip:', result.error);
        }
    } catch (error) {
      console.error('❌ Failed to equip cosmetic:', error);
    }
  };

  const handleUnequip = async (slot: 'trail' | 'headItem' | 'nameStyle') => {
    if (!walletAddress) return;

    try {
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      console.log('📦 Unequipping cosmetic via API:', { slot });
      
      const response = await fetch(`${serverUrl}/api/cosmetics/unequip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, slot })
      });

      const result = await response.json();
        console.log('📦 Unequip result received:', result);
      
        if (result.success) {
          // IMPORTANT: Create a new object without the unequipped slot
          const newEquipped = { ...equippedCosmetics };
          delete newEquipped[slot]; // Remove the slot
          
          console.log('✅ Updating equipped cosmetics to:', newEquipped);
          console.log('   Removed slot:', slot);
          
          setEquippedCosmetics(newEquipped);
          
          // Force re-render by also updating profile if it exists
          if (profile) {
            setProfile({
              ...profile,
              equippedCosmetics: newEquipped
            });
          }
        } else {
          console.error('❌ Failed to unequip:', result.error);
      }
    } catch (error) {
      console.error('❌ Failed to unequip cosmetic:', error);
    }
  };

  const getCosmeticIcon = (cosmeticId: string) => {
    if (cosmeticId === 'trail_basic_glow') return '💠';
    if (cosmeticId === 'trail_rainbow') return '🌈';
    if (cosmeticId === 'trail_fire') return '🔥';
    if (cosmeticId === 'trail_lightning') return '⚡';
    if (cosmeticId === 'trail_shadow') return '🌑';
    if (cosmeticId === 'head_party_hat') return '🎉';
    if (cosmeticId === 'head_sunglasses') return '😎';
    if (cosmeticId === 'head_halo') return '😇';
    if (cosmeticId === 'head_devil_horns') return '😈';
    if (cosmeticId === 'head_crown') return '👑';
    if (cosmeticId === 'name_rainbow') return '🌈';
    if (cosmeticId === 'name_gold_glow') return '✨';
    if (cosmeticId === 'name_neon_pulse') return '💫';
    if (cosmeticId === 'name_fire') return '🔥';
    if (cosmeticId === 'name_ice') return '❄️';
    return '⭐';
  };

  const getCosmeticName = (cosmeticId: string) => {
    if (!allCosmetics) return cosmeticId;
    
    const allItems = [
      ...allCosmetics.trails || [],
      ...allCosmetics.headItems || [],
      ...allCosmetics.nameStyles || []
    ];
    
    const item = allItems.find((c: any) => c.id === cosmeticId);
    return item?.name || cosmeticId;
  };

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
        setEquippedCosmetics(profileData.user.equippedCosmetics || {});
        setUnlockedCosmetics(profileData.user.unlockedCosmetics || []);
        
        // Update parent apple balance if callback provided
        if (onAppleBalanceUpdate && profileData.user.apples !== undefined) {
          onAppleBalanceUpdate(profileData.user.apples);
        }
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
                  <div className="bg-black/30 rounded-xl p-4 col-span-2">
                    <div className="text-sm text-emerald-400/70 mb-1">Apples Collected</div>
                    <div className="text-3xl font-black text-red-400 flex items-center justify-center gap-2">
                      🎁 {appleBalance}
                    </div>
                  </div>
                </div>

                {/* Equipped Cosmetics */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-green-300">Equipped Cosmetics</h3>
                    <span className="text-xs text-gray-400">{unlockedCosmetics.length} items owned</span>
                  </div>
                  
                  {/* Full Loadout Preview */}
                  <div className="bg-black/50 rounded-xl p-4 border border-green-700/30 mb-4">
                    <div className="text-center mb-2">
                      <div className="text-xs text-gray-400">Your Snake</div>
                    </div>
                    <div className="h-48 w-full">
                      <SnakePreview
                        equippedCosmetics={equippedCosmetics}
                        showName={true}
                        playerName={profile.username}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {/* Trail Slot */}
                    <button
                      onClick={() => setSelectedSlot('trail')}
                      disabled={cosmeticsLoading || cosmeticsError}
                      className={`bg-blue-900/20 border-2 border-blue-700/30 rounded-xl p-4 text-center transition-all group ${
                        cosmeticsLoading || cosmeticsError 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'hover:border-blue-500/60'
                      }`}
                    >
                      <div className="text-xs text-blue-400 mb-2">Trail</div>
                      {equippedCosmetics.trail ? (
                        <>
                          <div className="text-3xl mb-1">{getCosmeticIcon(equippedCosmetics.trail)}</div>
                          <div className="text-xs text-white font-bold truncate">{getCosmeticName(equippedCosmetics.trail)}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl mb-2">✨</div>
                          <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">+</div>
                        </>
                      )}
                    </button>
                    
                    {/* Head Item Slot */}
                    <button
                      onClick={() => setSelectedSlot('headItem')}
                      disabled={cosmeticsLoading || cosmeticsError}
                      className={`bg-purple-900/20 border-2 border-purple-700/30 rounded-xl p-4 text-center transition-all group ${
                        cosmeticsLoading || cosmeticsError 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'hover:border-purple-500/60'
                      }`}
                    >
                      <div className="text-xs text-purple-400 mb-2">Head</div>
                      {equippedCosmetics.headItem ? (
                        <>
                          <div className="text-3xl mb-1">{getCosmeticIcon(equippedCosmetics.headItem)}</div>
                          <div className="text-xs text-white font-bold truncate">{getCosmeticName(equippedCosmetics.headItem)}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl mb-2">🎩</div>
                          <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">+</div>
                        </>
                      )}
                    </button>
                    
                    {/* Name Style Slot */}
                    <button
                      onClick={() => setSelectedSlot('nameStyle')}
                      disabled={cosmeticsLoading || cosmeticsError}
                      className={`bg-green-900/20 border-2 border-green-700/30 rounded-xl p-4 text-center transition-all group ${
                        cosmeticsLoading || cosmeticsError 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'hover:border-green-500/60'
                      }`}
                    >
                      <div className="text-xs text-green-400 mb-2">Name</div>
                      {equippedCosmetics.nameStyle ? (
                        <>
                          <div className="text-3xl mb-1">{getCosmeticIcon(equippedCosmetics.nameStyle)}</div>
                          <div className="text-xs text-white font-bold truncate">{getCosmeticName(equippedCosmetics.nameStyle)}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl mb-2">📝</div>
                          <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">+</div>
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* Loading/Error State */}
                  {cosmeticsLoading && (
                    <div className="text-center text-xs text-gray-400 mt-2">
                      Loading cosmetics...
                    </div>
                  )}
                  {cosmeticsError && (
                    <div className="text-center mt-2">
                      <div className="text-xs text-red-400 mb-1">Failed to load cosmetics</div>
                      <button
                        onClick={() => fetchAllCosmetics()}
                        className="text-xs text-green-400 hover:text-green-300 underline"
                    >
                        Retry
                      </button>
                  </div>
                  )}
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

      {/* Equip Modal */}
      <AnimatePresence>
        {selectedSlot && allCosmetics && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedSlot(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-gradient-to-br from-cyber-dark to-cyber-darker border-2 border-neon-green/50 rounded-2xl p-6 max-w-md w-full max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-neon-green">
                  {selectedSlot === 'trail' ? '✨ Trails' : selectedSlot === 'headItem' ? '🎩 Head Items' : '📝 Name Styles'}
                </h3>
                <button
                  onClick={() => setSelectedSlot(null)}
                  className="p-2 hover:bg-green-900/50 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                {/* Unequip Option (if something is equipped) */}
                {equippedCosmetics[selectedSlot] && (
                  <button
                    onClick={() => {
                      handleUnequip(selectedSlot);
                      setSelectedSlot(null);
                    }}
                    className="w-full p-3 bg-red-900/30 border border-red-700/50 rounded-lg hover:bg-red-900/50 transition-all text-left"
                  >
                    <div className="text-sm font-bold text-red-400">❌ Unequip Current</div>
                  </button>
                )}

                {/* List ALL cosmetics for this category (unlocked at top, locked at bottom) */}
                {!allCosmetics ? (
                  <div className="text-center py-4 text-gray-400">Loading cosmetics...</div>
                ) : (() => {
                    const categoryKey = selectedSlot === 'trail' ? 'trails' : selectedSlot === 'headItem' ? 'headItems' : 'nameStyles';
                    const allItems = allCosmetics[categoryKey] || [];
                    
                    // Sort: unlocked first, then locked
                    const sortedItems = [...allItems].sort((a: any, b: any) => {
                      const aUnlocked = unlockedCosmetics.includes(a.id);
                      const bUnlocked = unlockedCosmetics.includes(b.id);
                      if (aUnlocked && !bUnlocked) return -1;
                      if (!aUnlocked && bUnlocked) return 1;
                      return 0;
                    });
                    
                    return sortedItems.map((cosmetic: any) => {
                    const isEquipped = equippedCosmetics[selectedSlot] === cosmetic.id;
                      const isUnlocked = unlockedCosmetics.includes(cosmetic.id);
                      const isLocked = !isUnlocked;

                    return (
                      <button
                        key={cosmetic.id}
                        onClick={() => {
                            if (isUnlocked && !isEquipped) {
                          handleEquip(cosmetic.id, selectedSlot);
                          setSelectedSlot(null);
                            }
                        }}
                          disabled={isEquipped || isLocked}
                        className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                          isEquipped
                            ? 'bg-green-900/30 border-green-500/50 cursor-not-allowed'
                              : isLocked
                              ? 'bg-gray-900/10 border-gray-700/20 opacity-50 cursor-not-allowed'
                              : 'bg-gray-900/30 border-gray-700/30 hover:border-neon-green/50 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-3xl">{getCosmeticIcon(cosmetic.id)}</div>
                            <div>
                                <div className="flex items-center gap-2">
                              <div className="text-sm font-bold text-white">{cosmetic.name}</div>
                                  {isLocked && <span className="text-xs">🔒</span>}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {cosmetic.description}
                                  {isLocked && cosmetic.cost && (
                                    <span className="ml-2 text-red-400">🎁 {cosmetic.cost}</span>
                                  )}
                                </div>
                            </div>
                          </div>
                          {isEquipped && (
                            <span className="text-green-400 font-bold text-xl">✓</span>
                          )}
                        </div>
                      </button>
                    );
                    });
                  })()
                }

                {/* Show message if no items in this category at all */}
                {allCosmetics && 
                 (allCosmetics[selectedSlot === 'trail' ? 'trails' : selectedSlot === 'headItem' ? 'headItems' : 'nameStyles'] || []).length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <div className="text-4xl mb-2">📦</div>
                    <div className="text-sm">No cosmetics available in this category</div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}


