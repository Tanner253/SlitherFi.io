'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SnakePreview } from '../components/SnakePreview';
import SnowEffect from '../components/SnowEffect';

interface CosmeticItem {
  id: string;
  name: string;
  description: string;
  category: 'trail' | 'headItem' | 'nameStyle';
  cost: number;
  rarity?: string;
}

interface CosmeticsData {
  trails: CosmeticItem[];
  headItems: CosmeticItem[];
  nameStyles: CosmeticItem[];
}

export default function StorePage() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const [appleBalance, setAppleBalance] = useState(0);
  const [cosmetics, setCosmetics] = useState<CosmeticsData>({ trails: [], headItems: [], nameStyles: [] });
  const [unlockedCosmetics, setUnlockedCosmetics] = useState<string[]>([]);
  const [selectedCosmetic, setSelectedCosmetic] = useState<CosmeticItem | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      router.push('/');
      return;
    }

    fetchStoreData();
  }, [walletAddress, router]);

  const fetchStoreData = async () => {
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    
    try {
      // Fetch all cosmetics
      const cosmeticsRes = await fetch(`${serverUrl}/api/cosmetics`);
      const cosmeticsData = await cosmeticsRes.json();
      console.log('📦 Received cosmetics data:', cosmeticsData);
      setCosmetics(cosmeticsData);
      
      // Fetch user's cosmetics data
      const userCosmeticsRes = await fetch(`${serverUrl}/api/user/${walletAddress}/cosmetics`);
      const userCosmeticsData = await userCosmeticsRes.json();
      console.log('👤 Received user cosmetics data:', userCosmeticsData);
      
      if (userCosmeticsData.success) {
        setAppleBalance(userCosmeticsData.appleBalance || 0);
        setUnlockedCosmetics(userCosmeticsData.unlockedCosmetics || []);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch store data:', error);
      setLoading(false);
      setToastMessage({ message: '❌ Failed to load store data', type: 'error' });
    }
  };

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handlePurchase = async () => {
    if (!selectedCosmetic || !walletAddress) return;
    
    setPurchasing(true);
    const cosmeticName = selectedCosmetic.name;
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    
    try {
      const response = await fetch(`${serverUrl}/api/cosmetics/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          cosmeticId: selectedCosmetic.id,
        })
      });
      
      const result = await response.json();
      console.log('🎁 Purchase result:', result);
      
      setPurchasing(false);
      
      if (result.success) {
        setAppleBalance(result.newBalance);
        setUnlockedCosmetics(result.unlockedCosmetics);
        setSelectedCosmetic(null);
        setToastMessage({ message: `✅ ${cosmeticName} unlocked! Go to your Profile to equip it.`, type: 'success' });
      } else {
        const errorMsg = result.error === 'insufficient_balance' ? 'Not enough presents!' :
                         result.error === 'already_owned' ? 'You already own this!' :
                         'Purchase failed. Try again.';
        setToastMessage({ message: `❌ ${errorMsg}`, type: 'error' });
      }
    } catch (error) {
      console.error('Failed to purchase cosmetic:', error);
      setPurchasing(false);
      setToastMessage({ message: '❌ Purchase failed. Try again.', type: 'error' });
    }
  };

  const getCosmeticIcon = (cosmetic: CosmeticItem) => {
    // Trail icons
    if (cosmetic.id === 'trail_basic_glow') return '💠';
    if (cosmetic.id === 'trail_rainbow') return '🌈';
    if (cosmetic.id === 'trail_fire') return '🔥';
    if (cosmetic.id === 'trail_lightning') return '⚡';
    if (cosmetic.id === 'trail_shadow') return '🌑';
    
    // Head item icons
    if (cosmetic.id === 'head_party_hat') return '🎉';
    if (cosmetic.id === 'head_sunglasses') return '😎';
    if (cosmetic.id === 'head_halo') return '😇';
    if (cosmetic.id === 'head_devil_horns') return '😈';
    if (cosmetic.id === 'head_crown') return '👑';
    
    // Name style icons
    if (cosmetic.id === 'name_rainbow') return '🌈';
    if (cosmetic.id === 'name_gold_glow') return '✨';
    if (cosmetic.id === 'name_neon_pulse') return '💫';
    if (cosmetic.id === 'name_fire') return '🔥';
    if (cosmetic.id === 'name_ice') return '❄️';
    
    return '⭐';
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-cyber-darker to-cyber-dark p-4 md:p-8">
      {/* Christmas snow effect */}
      <SnowEffect />
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="p-2 hover:bg-green-900/50 rounded-lg transition-all"
            >
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-green via-neon-blue to-neon-purple">
              🎁 Cosmetics Store
            </h1>
          </div>
          
          <div className="bg-red-900/30 px-4 py-2 rounded-lg border border-red-700/30">
            <span className="text-xl font-black text-red-400">🎁 {appleBalance}</span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-green-400">Loading store...</div>
        ) : (
          <div className="space-y-12">
            {/* Trails Section */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <span className="text-4xl">✨</span>
                <h2 className="text-3xl font-black text-blue-300">Trails</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cosmetics.trails.map((cosmetic) => {
                  const isUnlocked = unlockedCosmetics.includes(cosmetic.id);
                  const canAfford = appleBalance >= cosmetic.cost;

                  return (
                    <div
                      key={cosmetic.id}
                      className={`p-4 rounded-xl border-2 ${
                        isUnlocked
                          ? 'bg-green-900/30 border-green-500/50'
                          : 'bg-gray-900/30 border-gray-700/30'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="text-4xl">{getCosmeticIcon(cosmetic)}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-white">{cosmetic.name}</h3>
                                {isUnlocked && (
                                  <span className="px-2 py-0.5 bg-green-600/30 text-green-400 text-xs font-bold rounded">
                                    OWNED
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-400">{cosmetic.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-2xl font-black text-red-400">🎁 {cosmetic.cost}</div>

                            {isUnlocked ? (
                              <div className="px-4 py-2 bg-green-600/20 text-green-400 rounded-lg font-bold text-sm">
                                ✓
                              </div>
                            ) : (
                              <button
                                onClick={() => setSelectedCosmetic(cosmetic)}
                                disabled={!canAfford}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                                  canAfford
                                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white'
                                    : 'bg-gray-700/30 text-gray-500 cursor-not-allowed'
                                }`}
                              >
                                {canAfford ? 'Buy' : 'Locked'}
                              </button>
                            )}
                          </div>
                        </div>
                        
                        {/* Preview */}
                        <div className="bg-black/50 rounded-lg p-2 border border-gray-700/30 h-32">
                          <SnakePreview
                            equippedCosmetics={{ trail: cosmetic.id }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Head Items Section */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <span className="text-4xl">🎩</span>
                <h2 className="text-3xl font-black text-purple-300">Head Items</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cosmetics.headItems.map((cosmetic) => {
                  const isUnlocked = unlockedCosmetics.includes(cosmetic.id);
                  const canAfford = appleBalance >= cosmetic.cost;

                  return (
                    <div
                      key={cosmetic.id}
                      className={`p-4 rounded-xl border-2 ${
                        isUnlocked
                          ? 'bg-green-900/30 border-green-500/50'
                          : 'bg-gray-900/30 border-gray-700/30'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="text-4xl">{getCosmeticIcon(cosmetic)}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-white">{cosmetic.name}</h3>
                                {isUnlocked && (
                                  <span className="px-2 py-0.5 bg-green-600/30 text-green-400 text-xs font-bold rounded">
                                    OWNED
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-400">{cosmetic.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-2xl font-black text-red-400">🎁 {cosmetic.cost}</div>

                            {isUnlocked ? (
                              <div className="px-4 py-2 bg-green-600/20 text-green-400 rounded-lg font-bold text-sm">
                                ✓
                              </div>
                            ) : (
                              <button
                                onClick={() => setSelectedCosmetic(cosmetic)}
                                disabled={!canAfford}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                                  canAfford
                                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white'
                                    : 'bg-gray-700/30 text-gray-500 cursor-not-allowed'
                                }`}
                              >
                                {canAfford ? 'Buy' : 'Locked'}
                              </button>
                            )}
                          </div>
                        </div>
                        
                        {/* Preview */}
                        <div className="bg-black/50 rounded-lg p-2 border border-gray-700/30 h-36">
                          <SnakePreview
                            equippedCosmetics={{ headItem: cosmetic.id }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Name Styles Section */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <span className="text-4xl">📝</span>
                <h2 className="text-3xl font-black text-green-300">Name Styles</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cosmetics.nameStyles.map((cosmetic) => {
                  const isUnlocked = unlockedCosmetics.includes(cosmetic.id);
                  const canAfford = appleBalance >= cosmetic.cost;

                  return (
                    <div
                      key={cosmetic.id}
                      className={`p-4 rounded-xl border-2 ${
                        isUnlocked
                          ? 'bg-green-900/30 border-green-500/50'
                          : 'bg-gray-900/30 border-gray-700/30'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="text-4xl">{getCosmeticIcon(cosmetic)}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-white">{cosmetic.name}</h3>
                                {isUnlocked && (
                                  <span className="px-2 py-0.5 bg-green-600/30 text-green-400 text-xs font-bold rounded">
                                    OWNED
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-400">{cosmetic.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-2xl font-black text-red-400">🎁 {cosmetic.cost}</div>

                            {isUnlocked ? (
                              <div className="px-4 py-2 bg-green-600/20 text-green-400 rounded-lg font-bold text-sm">
                                ✓
                              </div>
                            ) : (
                              <button
                                onClick={() => setSelectedCosmetic(cosmetic)}
                                disabled={!canAfford}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                                  canAfford
                                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white'
                                    : 'bg-gray-700/30 text-gray-500 cursor-not-allowed'
                                }`}
                              >
                                {canAfford ? 'Buy' : 'Locked'}
                              </button>
                            )}
                          </div>
                        </div>
                        
                        {/* Preview */}
                        <div className="bg-black/50 rounded-lg p-2 border border-gray-700/30 h-36">
                          <SnakePreview
                            equippedCosmetics={{ nameStyle: cosmetic.id }}
                            showName={true}
                            playerName="Preview"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Purchase Confirmation Modal */}
      <AnimatePresence>
        {selectedCosmetic && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedCosmetic(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-gradient-to-br from-red-900/95 to-orange-900/95 border-2 border-yellow-400 rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-2xl font-black text-yellow-400 mb-4">Confirm Purchase</h3>
              
              <div className="bg-black/30 rounded-xl p-4 mb-4">
                <div className="text-lg font-bold text-white mb-1">{selectedCosmetic.name}</div>
                <div className="text-sm text-gray-300 mb-3">{selectedCosmetic.description}</div>
                
                {/* Preview */}
                <div className="bg-black/60 rounded-lg p-3 border border-gray-700/30">
                  <div className="text-xs text-gray-400 mb-2 text-center">Preview</div>
                  <div className="h-40">
                    <SnakePreview
                      equippedCosmetics={{ [selectedCosmetic.category]: selectedCosmetic.id }}
                      showName={selectedCosmetic.category === 'nameStyle'}
                      playerName="Preview"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Cost:</span>
                  <span className="text-2xl font-black text-red-400">🎁 {selectedCosmetic.cost}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Your Balance:</span>
                  <span className="text-xl font-bold text-white">🎁 {appleBalance}</span>
                </div>
                <div className="border-t border-gray-700 my-2"></div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">After Purchase:</span>
                  <span className="text-xl font-bold text-green-400">🎁 {appleBalance - selectedCosmetic.cost}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedCosmetic(null)}
                  className="flex-1 px-4 py-3 bg-gray-700/30 hover:bg-gray-700/50 rounded-lg font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePurchase}
                  disabled={purchasing}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 rounded-lg font-bold transition-all disabled:opacity-50"
                >
                  {purchasing ? 'Purchasing...' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: 50 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 50, x: 50 }}
            className={`fixed bottom-8 right-8 ${
              toastMessage.type === 'success' 
                ? 'bg-gradient-to-r from-green-900 to-emerald-900 border-green-500/50' 
                : 'bg-gradient-to-r from-red-900 to-orange-900 border-red-500/50'
            } border-2 rounded-xl px-6 py-4 shadow-2xl z-50 max-w-md`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{toastMessage.type === 'success' ? '✅' : '❌'}</span>
              <p className="text-white font-medium">{toastMessage.message}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

