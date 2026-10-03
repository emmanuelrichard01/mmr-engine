'use client';

import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { DURATION, EASE_OUT, STAGGER_LIMIT, STAGGER_STEP } from '@/lib/motion';

/**
 * Fades a section up as it enters the viewport, once. Content is laid out
 * from the start (no shift); only opacity and a few pixels of translation move.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section';
}) {
  const reduce = useReducedMotion();
  const Comp = as === 'section' ? motion.section : motion.div;
  if (reduce) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: DURATION.reveal, ease: EASE_OUT, delay }}
    >
      {children}
    </Comp>
  );
}

/** Motion props for the i-th row of a freshly loaded list: only the first rows stagger. */
export function rowReveal(index: number, reduce: boolean | null) {
  if (reduce) return {};
  return {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: DURATION.slow,
      ease: EASE_OUT,
      delay: Math.min(index, STAGGER_LIMIT) * STAGGER_STEP,
    },
  };
}
