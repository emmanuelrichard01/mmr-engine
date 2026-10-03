'use client';

import { AlertTriangle, FlaskConical, RotateCw } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { cn, formatTime } from '@/lib/utils';

// ── Demo-mode banner ──────────────────────────────────────────────────

/** Rendered by the shell on every page when DEMO_MODE is on. Not dismissible. */
export function DemoModeBanner() {
  return (
    <div role="note" aria-label="Demo data" className="demo-banner">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <p className="min-w-0">
        <strong className="font-semibold">Demo data, not a live engine.</strong>{' '}
        <span className="max-sm:hidden">
          Every figure is generated in this browser (NEXT_PUBLIC_DEMO_MODE=true). Resolutions change this tab only and
          reset on reload.
        </span>
      </p>
    </div>
  );
}

// ── Errors ────────────────────────────────────────────────────────────

export function describeError(error: ApiError): string {
  if (error.status === 0) return error.detail;
  if (error.status === 401 || error.status === 403) {
    return `${error.detail} (HTTP ${error.status}). Check MMR_API_KEY on the dashboard server.`;
  }
  if (error.status === 404 && error.detail === 'Not proxied') {
    return 'This route is not on the dashboard proxy allow-list.';
  }
  return `${error.detail} (HTTP ${error.status})`;
}

/** The request never reached the engine (network failure, proxy 502/504). */
export function isConnectionError(error: ApiError | null): boolean {
  return !!error && (error.status === 0 || error.status === 502 || error.status === 504);
}

function RetryButton({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <button type="button" onClick={onRetry} disabled={retrying} className="btn btn-secondary btn-sm shrink-0">
      <RotateCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
      {retrying ? 'Retrying' : 'Retry'}
    </button>
  );
}

/** Inline banner: something failed, with what and how to recover. */
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
    <div role="alert" className={cn('notice notice-error items-center', className)}>
      <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Couldn’t load {what}.</p>
        <p className="opacity-90">{describeError(error)}</p>
        {staleSince ? <p className="opacity-90">Showing the last good response, from {formatTime(staleSince)}.</p> : null}
      </div>
      {onRetry && <RetryButton onRetry={onRetry} retrying={retrying} />}
    </div>
  );
}

/**
 * Error inside one panel. When the engine itself is unreachable the page shows
 * a single banner, so panels only say "Unavailable" instead of repeating it.
 */
export function PanelError({
  error,
  what,
  onRetry,
  retrying,
  className,
}: {
  error: ApiError;
  what: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <p className="text-[13.5px] font-medium text-fg">
        {isConnectionError(error) ? 'Unavailable: the MMR API could not be reached.' : `Couldn’t load ${what}.`}
      </p>
      {!isConnectionError(error) && <p className="t-caption max-w-[48ch]">{describeError(error)}</p>}
      {onRetry && <RetryButton onRetry={onRetry} retrying={retrying} />}
    </div>
  );
}
