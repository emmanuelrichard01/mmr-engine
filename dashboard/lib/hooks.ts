'use client';

// ─── Data hooks ──────────────────────────────────────────────────────────────
// Real API data or a real error — never a silent substitute. Hooks re-fetch
// whenever their key (the serialised request parameters) changes, cancel
// stale requests, and optionally poll while the tab is visible.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  fetchDailyReports,
  fetchDiscrepancies,
  fetchDiscrepancyEvents,
  fetchExposure,
  fetchPspHealth,
  fetchReadiness,
  fetchSummary,
  fetchTrend,
  resolveDiscrepancy,
  toApiError,
  type DiscrepancyFilters,
  type ResolveOutcome,
  type ResolveResponse,
} from './api';

export interface QueryResult<T> {
  data: T | null;
  error: ApiError | null;
  /** True until the first response (or error) for the current key. */
  isLoading: boolean;
  /** True while re-fetching a key that already has data. */
  isRefreshing: boolean;
  /** Epoch ms of the last successful response. */
  updatedAt: number | null;
  refetch: () => void;
}

interface QueryState<T> {
  key: string;
  data: T | null;
  error: ApiError | null;
  pending: boolean;
  updatedAt: number | null;
}

function useQuery<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { refreshMs?: number } = {},
): QueryResult<T> {
  const { refreshMs } = options;
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [tick, setTick] = useState(0);
  const [state, setState] = useState<QueryState<T>>({
    key,
    data: null,
    error: null,
    pending: true,
    updatedAt: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) =>
      prev.key === key
        ? { ...prev, pending: true }
        : { key, data: null, error: null, pending: true, updatedAt: null },
    );
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setState({ key, data, error: null, pending: false, updatedAt: Date.now() });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          key,
          data: prev.key === key ? prev.data : null,
          updatedAt: prev.key === key ? prev.updatedAt : null,
          error: toApiError(err),
          pending: false,
        }));
      },
    );
    return () => controller.abort();
  }, [key, tick]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    isLoading: !current || (state.pending && state.data === null && state.error === null),
    isRefreshing: current && state.pending && (state.data !== null || state.error !== null),
    updatedAt: current ? state.updatedAt : null,
    refetch,
  };
}

// ─── Endpoint hooks ──────────────────────────────────────────────────────────

const MINUTE = 60_000;

export function useReadiness() {
  return useQuery('readiness', (s) => fetchReadiness(s), { refreshMs: 30_000 });
}

export function useSummary() {
  return useQuery('summary', (s) => fetchSummary(s), { refreshMs: MINUTE });
}

export function useTrend(days: number) {
  return useQuery(`trend:${days}`, (s) => fetchTrend(days, s), { refreshMs: 5 * MINUTE });
}

export function usePspHealth() {
  return useQuery('psp-health', (s) => fetchPspHealth(s), { refreshMs: MINUTE });
}

export function useExposure() {
  return useQuery('exposure', (s) => fetchExposure(s), { refreshMs: MINUTE });
}

/** Filters are part of the query key, so any change triggers a fresh API request. */
export function useDiscrepancies(filters: DiscrepancyFilters, options: { refreshMs?: number } = {}) {
  const key = `discrepancies:${filters.status}:${filters.severity ?? ''}:${filters.psp_name ?? ''}:${filters.limit}:${filters.offset}`;
  return useQuery(key, (s) => fetchDiscrepancies(filters, s), options);
}

export function useDiscrepancyEvents(id: number) {
  return useQuery(`discrepancy-events:${id}`, (s) => fetchDiscrepancyEvents(id, s));
}

export function useDailyReports(params: { limit: number; offset: number }) {
  return useQuery(`reports:${params.limit}:${params.offset}`, (s) => fetchDailyReports(params, s));
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useResolveDiscrepancy() {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const resolve = useCallback(async (id: number, note: string, outcome: ResolveOutcome): Promise<ResolveResponse | null> => {
    setIsResolving(true);
    setError(null);
    try {
      return await resolveDiscrepancy(id, note, outcome);
    } catch (err) {
      setError(toApiError(err));
      return null;
    } finally {
      setIsResolving(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { resolve, isResolving, error, reset };
}

// ─── Clock ───────────────────────────────────────────────────────────────────

/**
 * Current time for relative labels ("6h ago"). Null during server render and
 * the first client render, so markup never differs between the two.
 */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
