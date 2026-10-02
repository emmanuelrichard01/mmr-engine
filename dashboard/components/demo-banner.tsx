'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X, Wifi, WifiOff, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DemoBannerProps {
  className?: string;
}

/**
 * Demo mode banner — shown when the dashboard is operating on
 * fallback demo data because the live API is unreachable.
 * More prominent than before so users can't miss it.
 */
export function DemoBanner({ className }: DemoBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg animate-fade-in',
        'border border-[var(--color-warning-500)]/25',
        className
      )}
      style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-warning-500) 8%, var(--color-surface-50)), color-mix(in srgb, var(--color-warning-500) 4%, var(--color-surface-50)))',
      }}
    >
      {/* Subtle decorative stripe on left edge */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-warning-500)] rounded-l-xl" />

      <div className="flex items-center justify-between gap-4 px-5 py-3 pl-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-warning-500)]/15 shrink-0">
            <AlertTriangle className="w-4 h-4 text-[var(--color-warning-500)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-warning-600)]">
                Demo Mode Active
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-warning-500)]/15 text-[10px] font-bold text-[var(--color-warning-600)] uppercase tracking-wide">
                Sample Data
              </span>
            </div>
            <p className="text-[12px] text-[var(--color-surface-500)] mt-0.5">
              Live API is unreachable — figures shown are illustrative, not real.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/settings"
            className="hidden sm:flex items-center gap-1 text-[12px] font-semibold text-[var(--color-primary-500)] hover:text-[var(--color-primary-600)] transition-colors group"
          >
            Connect live API
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <button
            onClick={() => setDismissed(true)}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--color-surface-200)]/60 text-[var(--color-surface-400)] hover:text-[var(--color-surface-600)] transition-colors"
            aria-label="Dismiss demo banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Live Indicator ────────────────────────────────────────────────────

interface LiveIndicatorProps {
  isConnected: boolean | null;
  className?: string;
}

/**
 * Compact live/demo indicator pill for the header bar.
 */
export function LiveIndicator({ isConnected, className }: LiveIndicatorProps) {
  if (isConnected === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-surface-400)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-surface-300)]" />
        Connecting…
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        isConnected
          ? 'text-[var(--color-success-600)]'
          : 'text-[var(--color-warning-600)]',
        className
      )}
    >
      {isConnected ? (
        <>
          <span className="status-dot status-dot-live" />
          <Wifi className="w-3 h-3" />
          Live
        </>
      ) : (
        <>
          <span className="status-dot status-dot-warning" />
          <WifiOff className="w-3 h-3" />
          Demo
        </>
      )}
    </span>
  );
}
