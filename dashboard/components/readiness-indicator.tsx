'use client';

import Link from 'next/link';
import { DEMO_MODE, type ApiError, type ReadinessResult } from '@/lib/api';
import { useReadiness } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export type ReadinessState = 'checking' | 'ready' | 'degraded' | 'down' | 'demo';

export function readinessState(
  data: ReadinessResult | null,
  error: ApiError | null,
  isLoading: boolean,
): ReadinessState {
  if (DEMO_MODE) return 'demo';
  if (error) return 'down';
  if (isLoading || !data) return 'checking';
  if (data.httpStatus === 200 && data.body?.status === 'healthy') return 'ready';
  return 'degraded';
}

export const READINESS_LABEL: Record<ReadinessState, string> = {
  checking: 'Checking engine…',
  ready: 'Engine ready',
  degraded: 'Engine degraded',
  down: 'Engine unreachable',
  demo: 'Demo data',
};

const DOT_CLASS: Record<ReadinessState, string> = {
  checking: 'status-dot-offline',
  ready: 'status-dot-ok',
  degraded: 'status-dot-warning',
  down: 'status-dot-error',
  demo: 'status-dot-warning',
};

/**
 * Compact readiness pill driven by /health/ready (not the /health liveness
 * probe). Links to the System page for the per-service breakdown.
 */
export function ReadinessIndicator({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const { data, error, isLoading } = useReadiness();
  const state = readinessState(data, error, isLoading);
  const label = READINESS_LABEL[state];

  return (
    <Link
      href="/system"
      className={cn('readiness-pill', collapsed && 'justify-center px-0', className)}
      title={collapsed ? label : 'Readiness from /health/ready — open System for details'}
      aria-label={`${label}. Open system status.`}
    >
      <span className={cn('status-dot', DOT_CLASS[state])} aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
