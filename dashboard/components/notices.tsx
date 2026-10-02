'use client';

import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, X } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { cn, formatTime } from '@/lib/utils';

// ── Demo-mode banner ──────────────────────────────────────────────────

/** Rendered by the dashboard layout on every page when DEMO_MODE is on. Not dismissible. */
export function DemoModeBanner() {
  return (
    <div role="status" className="demo-banner">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2} />
      <p>
        <strong>Demo data — not connected to a live engine.</strong>{' '}
        <span className="demo-banner-detail">
          This build uses bundled fixtures (NEXT_PUBLIC_DEMO_MODE=true). No figure on this page comes from real
          transactions.
        </span>
      </p>
    </div>
  );
}

// ── Error notice ──────────────────────────────────────────────────────

function describe(error: ApiError): string {
  if (error.status === 0) return error.detail;
  if (error.status === 401 || error.status === 403) {
    return `${error.detail} (HTTP ${error.status}). Check MMR_API_KEY on the dashboard server.`;
  }
  return `${error.detail} (HTTP ${error.status})`;
}

export function ErrorNotice({
  error,
  what,
  onRetry,
  retrying,
  staleSince,
  className,
}: {
  error: ApiError;
  /** What failed to load, e.g. "the reconciliation summary". */
  what: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** When set, older data is still on screen; say how old it is. */
  staleSince?: number | null;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('notice notice-error', className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Couldn’t load {what}.</p>
        <p className="notice-detail">{describe(error)}</p>
        {staleSince ? (
          <p className="notice-detail">Showing the last successful response, from {formatTime(staleSince)}.</p>
        ) : null}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying} className="btn btn-secondary btn-sm shrink-0">
          <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} aria-hidden="true" />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}

/** The request never reached the engine (network failure, proxy 502/504). */
export function isConnectionError(error: ApiError | null): boolean {
  return !!error && (error.status === 0 || error.status === 502 || error.status === 504);
}

/**
 * Error for one panel. When the engine itself is unreachable, the page shows a
 * single notice and panels just say "Unavailable" instead of repeating it.
 */
export function PanelError({
  error,
  what,
  onRetry,
  retrying,
}: {
  error: ApiError;
  what: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (isConnectionError(error)) {
    return <p className="text-body py-6 text-center">Unavailable — the MMR API could not be reached.</p>;
  }
  return <ErrorNotice error={error} what={what} onRetry={onRetry} retrying={retrying} />;
}

// ── Toast ─────────────────────────────────────────────────────────────

export function Toast({ message, onClose, durationMs = 5000 }: { message: string; onClose: () => void; durationMs?: number }) {
  useEffect(() => {
    const id = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(id);
  }, [onClose, durationMs]);

  return (
    <div className="toast" role="status">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success-400)]" aria-hidden="true" />
      <span>{message}</span>
      <button type="button" onClick={onClose} className="toast-close" aria-label="Dismiss notification">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
