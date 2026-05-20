'use client';

import { useState } from 'react';
import { AlertTriangle, X, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DemoBannerProps {
  className?: string;
}

export function DemoBanner({ className }: DemoBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg',
        'bg-[var(--color-warning-500)]/10 border border-[var(--color-warning-500)]/20',
        'animate-fade-in',
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-warning-500)]/20 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-warning-400)]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-warning-400)]">
            Demo Mode
          </span>
          <span className="text-xs text-[var(--color-surface-500)]">
            Showing sample data — live API is unreachable
          </span>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-[var(--color-surface-200)]/50 text-[var(--color-surface-500)] transition-colors shrink-0"
        aria-label="Dismiss demo banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface LiveIndicatorProps {
  isConnected: boolean | null;
  className?: string;
}

export function LiveIndicator({ isConnected, className }: LiveIndicatorProps) {
  if (isConnected === null) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        isConnected
          ? 'bg-[var(--color-success-500)]/15 text-[var(--color-success-400)]'
          : 'bg-[var(--color-warning-500)]/15 text-[var(--color-warning-400)]',
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          isConnected
            ? 'bg-[var(--color-success-400)] animate-pulse'
            : 'bg-[var(--color-warning-400)]'
        )}
      />
      {isConnected ? (
        <>
          <Wifi className="w-3 h-3" />
          Live
        </>
      ) : (
        'Demo'
      )}
    </div>
  );
}
