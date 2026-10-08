// src/features/customer/components/CrossSellPrompt.jsx
import React from 'react';
import { ArrowUp, ShoppingCart } from 'lucide-react';
import { motion } from 'framer-motion';

const CrossSellPrompt = ({
  title,
  description,
  skipLabel = 'おすすめを閉じる',
  cartItemCount = 0,
  onSkip
}) => {
  return (
    <motion.div
      layout
      key={`${title || ''}-${description || ''}`}
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: [0.985, 1.025, 1]
      }}
      transition={{
        opacity: { duration: 0.18, ease: 'easeOut' },
        y: { duration: 0.22, ease: 'easeOut' },
        scale: { duration: 0.8, ease: 'easeOut' },
        layout: { duration: 0.22, ease: 'easeOut' }
      }}
      className="relative w-full overflow-hidden rounded-b-3xl bg-[#0B1220] shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
    >
      <motion.div
        className="pointer-events-none absolute inset-0 z-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.28, 0.14, 0] }}
        transition={{ duration: 1.35, ease: 'easeOut' }}
        style={{ backgroundColor: '#D9C08A' }}
      />

      <motion.div
        className="pointer-events-none absolute inset-x-4 top-0 z-0 h-px"
        initial={{ opacity: 0, scaleX: 0.2 }}
        animate={{ opacity: [0, 1, 0.65, 0], scaleX: [0.15, 1, 1, 1] }}
        transition={{ duration: 1.25, ease: 'easeOut' }}
        style={{ backgroundColor: '#D9C08A' }}
      />

      <div className="relative z-10 px-4 pb-4 pt-6">
        <div className="mx-auto max-w-screen-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-black leading-snug tracking-tight text-white">
                {title || 'こちらもいかがですか？'}
              </h2>

                {description && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-bold leading-relaxed text-white/60">
                    <motion.span
                      initial={{ y: 2, opacity: 0 }}
                      animate={{ y: [2, -3, 0, -2, 0], opacity: 1 }}
                      transition={{ duration: 1.1, ease: 'easeOut', delay: 0.15 }}
                      className="inline-flex shrink-0 text-[#D9C08A]"
                    >
                      <ArrowUp size={14} strokeWidth={3} />
                    </motion.span>

                    <span>{description}</span>
                  </div>
                )}
            </div>

            {cartItemCount > 0 && (
              <motion.div
                key={cartItemCount}
                initial={{ scale: 0.86 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
                aria-label={`おすすめ中に追加済み ${cartItemCount} 点`}
              >
                <ShoppingCart size={15} strokeWidth={3} />

                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D9C08A] px-1 text-[10px] font-black leading-none text-[#0B1220] ring-2 ring-[#0B1220]">
                  {cartItemCount}
                </span>
              </motion.div>
            )}
          </div>

          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-[#D9C08A] bg-transparent px-5 text-sm font-black text-[#D9C08A] transition-all hover:bg-white/5 active:scale-[0.98]"
            >
              {skipLabel || 'おすすめを閉じる'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default CrossSellPrompt;