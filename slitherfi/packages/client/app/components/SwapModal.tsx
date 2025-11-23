'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  requiredBalance: number;
}

export function SwapModal({ isOpen, onClose, currentBalance, requiredBalance }: SwapModalProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const SLITH_CA = '6WQxQRguwYVwrHpFkNJsLK2XRnWLuqaLuQ8VBGXupump';
  const tokensNeeded = Math.max(0, requiredBalance - currentBalance);

  const copyCA = async () => {
    try {
      await navigator.clipboard.writeText(SLITH_CA);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const openJupiter = () => {
    const jupiterUrl = `https://jup.ag/swap/SOL-${SLITH_CA}`;
    window.open(jupiterUrl, '_blank');
  };

  const openRaydium = () => {
    const raydiumUrl = `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${SLITH_CA}`;
    window.open(raydiumUrl, '_blank');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 50 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 50 }}
          className="relative w-full max-w-md bg-gradient-to-br from-green-950 via-emerald-900 to-green-950 rounded-3xl border-2 border-green-600/50 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-lime-600 via-green-600 to-emerald-600 p-6 border-b-2 border-green-700/50">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-3xl font-black text-white mb-2 flex items-center gap-2">
                  <span>💎</span>
                  <span>Get $SLITH</span>
                </h2>
                <p className="text-sm text-green-100">Unlock access to the jungle</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Status */}
            <div className="bg-orange-900/30 border-2 border-orange-600/50 rounded-2xl p-4 text-center">
              <div className="text-5xl mb-3">🚫</div>
              <p className="text-orange-300 font-bold text-lg mb-2">Access Denied</p>
              <p className="text-sm text-green-200">
                You have <span className="text-white font-bold">{currentBalance.toLocaleString()}</span> $SLITH
              </p>
              <p className="text-sm text-green-200">
                Need <span className="text-lime-400 font-bold">{tokensNeeded.toLocaleString()}</span> more to enter
              </p>
            </div>

            {/* Token CA */}
            <div>
              <label className="text-xs text-green-400 mb-2 block font-semibold">Token Contract Address</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={SLITH_CA}
                  readOnly
                  className="flex-1 px-3 py-2 bg-green-950 border border-green-700 rounded-lg text-green-200 text-sm font-mono"
                />
                <button
                  onClick={copyCA}
                  className="px-4 py-2 bg-lime-600/30 border border-lime-500/50 text-lime-400 rounded-lg text-sm font-bold hover:bg-lime-600/40 transition-all"
                >
                  {copySuccess ? '✓' : '📋'}
                </button>
              </div>
            </div>

            {/* Quick Swap Options */}
            <div className="space-y-3">
              <p className="text-xs text-green-400 text-center font-semibold">Quick Swap Destinations:</p>
              
              <button
                onClick={openJupiter}
                className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-900/50"
              >
                <span className="text-lg">🪐</span>
                <span>Swap on Jupiter</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>

              <button
                onClick={openRaydium}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-700 hover:from-purple-700 hover:to-pink-800 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-900/50"
              >
                <span className="text-lg">⚡</span>
                <span>Swap on Raydium</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>

            {/* Info */}
            <div className="bg-lime-600/10 border border-lime-600/30 rounded-lg p-3">
              <p className="text-xs text-green-300 text-center">
                💡 After purchasing, your balance will refresh automatically when you close this window
              </p>
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="w-full py-3 bg-green-800 hover:bg-green-900 text-white rounded-xl font-bold transition-all"
            >
              Return to Jungle
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

