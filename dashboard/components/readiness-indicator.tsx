'use client';

import Link from 'next/link';
import { DEMO_MODE, type ApiError, type ReadinessResult } from '@/lib/api';
import { useReadiness } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export type ReadinessState = 'checking' | 'ready' | 'degraded' | 'down' | 'demo';

export function readinessState(data: ReadinessResult | null, error: ApiError | null, isLoading: boolean): ReadinessState {
  if (DEMO_MODE) return 'demo';
  if (error) return 'down';
  if (isLoading || !data) return 'checking';
  if (data.httpStatus === 200 && data.body?.status === 'healthy') return 'ready';
  return 'degraded';
}

export const READINESS_LABEL: Record<ReadinessState, string> = {
  checking: 'Checking engine',
  ready: 'Engine ready',
  degraded: 'Engine degraded',
  down: 'Engine unreachable',
  demo: 'Demo fixtures',
};

export const READINESS_DOT: Record<ReadinessState, string> = {
  checking: '',
  ready: 'dot-ok',
  degraded: 'dot-warn',
  down: 'dot-bad',
  demo: 'dot-warn',
};

/** Compact readiness link driven by /health/ready; opens the System page. */
export function ReadinessIndicator({ className }: { className?: string }) {
  const { data, error, isLoading } = useReadiness();
  const state = readinessState(data, error, isLoading);
  const label = READINESS_LABEL[state];

  return (
    <Link
      href="/system"
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:bg-panel-hover hover:text-fg',
        className,
      )}
      aria-label={`${label}. Open system status.`}
    >
      <span className={cn('dot', READINESS_DOT[state])} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
