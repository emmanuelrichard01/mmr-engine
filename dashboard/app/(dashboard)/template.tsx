'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { DURATION, EASE_OUT } from '@/lib/motion';

/**
 * Re-mounts on every navigation: each page settles in with a short fade and
 * lift. The markup is identical with or without reduced motion (the shell's
 * MotionConfig drops the lift and keeps a plain fade), so hydration matches.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
