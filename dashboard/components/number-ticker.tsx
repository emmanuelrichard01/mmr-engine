'use client';

import { useLayoutEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { interpolateKobo, koboParts } from '@/lib/money';
import { cn } from '@/lib/utils';

// Headline figures count up to their value when they first appear and glide
// between values on refresh. The animated text is hidden from assistive
// technology; the final value is always present as text for screen readers.
// Reduced motion: the final value, immediately.

export function Ticker({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef<number | null>(null);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = from.current ?? 0;
    from.current = value;
    if (reduce || start === value) {
      el.textContent = formatRef.current(value);
      return;
    }
    el.textContent = formatRef.current(start);
    const controls = animate(start, value, {
      duration: DURATION.draw,
      ease: EASE_OUT,
      onUpdate: (v) => {
        el.textContent = formatRef.current(v);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span className={cn('num', className)}>
      <span ref={ref} aria-hidden="true">
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/** Money counter: integer kobo throughout, with the naira sign and kobo set smaller. */
export function MoneyTicker({
  kobo,
  className,
  showKobo = true,
}: {
  kobo: bigint;
  className?: string;
  showKobo?: boolean;
}) {
  const wholeRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const signRef = useRef<HTMLSpanElement>(null);
  const from = useRef<bigint | null>(null);
  const reduce = useReducedMotion();
  const final = koboParts(kobo);

  useLayoutEffect(() => {
    const paint = (k: bigint) => {
      const p = koboParts(k);
      if (wholeRef.current) wholeRef.current.textContent = p.whole;
      if (fracRef.current) fracRef.current.textContent = `.${p.fraction}`;
      if (signRef.current) signRef.current.textContent = p.sign;
    };
    const start = from.current ?? BigInt(0);
    from.current = kobo;
    if (reduce || start === kobo) {
      paint(kobo);
      return;
    }
    paint(start);
    const controls = animate(0, 1, {
      duration: DURATION.draw,
      ease: EASE_OUT,
      onUpdate: (t) => paint(interpolateKobo(start, kobo, t)),
    });
    return () => controls.stop();
  }, [kobo, reduce]);

  return (
    <span className={cn('num inline-flex items-baseline', className)}>
      <span aria-hidden="true" className="inline-flex items-baseline">
        <span ref={signRef}>{final.sign}</span>
        <span className="mr-[0.08em] text-[0.62em] font-medium text-fg-subtle">₦</span>
        <span ref={wholeRef}>{final.whole}</span>
        <span ref={fracRef} className={cn('text-[0.62em] font-medium text-fg-subtle', !showKobo && 'hidden')}>
          .{final.fraction}
        </span>
      </span>
      <span className="sr-only">
        {final.sign}₦{final.whole}.{final.fraction}
      </span>
    </span>
  );
}
