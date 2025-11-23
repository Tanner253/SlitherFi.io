'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface LeaderboardEntry {
  walletAddress: string;
  username: string;
  totalWinnings: number;
  gamesWon: number;
}

export function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const response = await fetch(`${serverUrl}/api/leaderboard`);
        const data = await response.json();
        setLeaderboard(data.leaderboard || []);
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    // Refresh every 30 seconds
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatWallet = (wallet: string) => {
    return `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400">Loading leaderboard...</div>
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className="text-center py-16">
        <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
        <p className="text-gray-400 text-lg mb-2">No winners yet</p>
        <p className="text-gray-500 text-sm">Be the first to win and claim your spot!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {leaderboard.map((entry, index) => (
        <motion.div
          key={entry.walletAddress}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.02 }}
          className={`flex items-center justify-between p-3 rounded-lg border ${
            index === 0 
              ? 'bg-yellow-500/10 border-yellow-500/30' 
              : index === 1
              ? 'bg-gray-400/10 border-gray-400/30'
              : index === 2
              ? 'bg-orange-500/10 border-orange-500/30'
              : 'bg-cyber-darker/50 border-neon-green/10'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
              index === 0
                ? 'bg-yellow-500 text-black'
                : index === 1
                ? 'bg-gray-400 text-black'
                : index === 2
                ? 'bg-orange-500 text-black'
                : 'bg-neon-green/20 text-neon-green'
            }`}>
              {index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
            </div>
            <div>
              <div className="font-bold text-sm text-white mb-0.5">
                {entry.username}
              </div>
              <a
                href={`https://solscan.io/account/${entry.walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-neon-blue hover:text-neon-green transition-colors flex items-center gap-1"
              >
                {formatWallet(entry.walletAddress)}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <div className="text-xs text-gray-400 mt-0.5">
                {entry.gamesWon} wins
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-black text-neon-green">
              ${entry.totalWinnings.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">USDC</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

