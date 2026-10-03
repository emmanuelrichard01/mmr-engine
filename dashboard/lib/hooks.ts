'use client';

// ─── Data hooks ──────────────────────────────────────────────────────────────
// Real API data or a real error, never a silent substitute. Hooks re-fetch
// whenever their key (the serialised request parameters) changes, cancel
// stale requests, and optionally poll while the tab is visible.
//
// The last good response per key is kept in memory for this tab, so going back
// to a page shows what was there a moment ago (marked as refreshing) instead
// of a skeleton. It is the same data the API returned; nothing is invented.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  fetchDailyReports,
  fetchDiscrepancies,
  fetchDiscrepancyEvents,
  fetchExposure,
  fetchExposureAging,
  fetchPair,
  fetchPairs,
  fetchPipelineRuns,
  fetchPspHealth,
  fetchReadiness,
  fetchSearch,
  fetchSummary,
  fetchTransaction,
  fetchTransactions,
  fetchTrend,
  MIN_SEARCH_LENGTH,
  toApiError,
  type DiscrepancyFilters,
  type PairFilters,
  type TransactionFilters,
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

const cache = new Map<string, { data: unknown; updatedAt: number }>();
const mounted = new Map<string, Set<() => void>>();

/** Drop cached responses whose key starts with any prefix, and re-fetch the mounted ones. */
export function invalidateQueries(...prefixes: string[]) {
  const matches = (key: string) => prefixes.some((p) => key.startsWith(p));
  for (const key of [...cache.keys()]) if (matches(key)) cache.delete(key);
  for (const [key, refetchers] of mounted) if (matches(key)) refetchers.forEach((r) => r());
}

function initialState<T>(key: string, enabled: boolean): QueryState<T> {
  const hit = cache.get(key);
  return {
    key,
    data: (hit?.data as T) ?? null,
    error: null,
    pending: enabled,
    updatedAt: hit?.updatedAt ?? null,
  };
}

export function useQuery<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { refreshMs?: number; enabled?: boolean } = {},
): QueryResult<T> {
  const { refreshMs, enabled = true } = options;
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [tick, setTick] = useState(0);
  const [state, setState] = useState<QueryState<T>>(() => initialState<T>(key, enabled));

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => (prev.key === key ? { ...prev, pending: true } : initialState<T>(key, true)));
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        const updatedAt = Date.now();
        cache.set(key, { data, updatedAt });
        setState({ key, data, error: null, pending: false, updatedAt });
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
  }, [key, tick, enabled]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const set = mounted.get(key) ?? new Set();
    set.add(refetch);
    mounted.set(key, set);
    return () => {
      set.delete(refetch);
      if (set.size === 0) mounted.delete(key);
    };
  }, [key, refetch, enabled]);

  useEffect(() => {
    if (!refreshMs || !enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, enabled]);

  const current = state.key === key;
  if (!enabled) {
    return { data: null, error: null, isLoading: false, isRefreshing: false, updatedAt: null, refetch };
  }
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
  return useQuery('exposure:totals', (s) => fetchExposure(s), { refreshMs: MINUTE });
}

export function useExposureAging() {
  return useQuery('exposure:aging', (s) => fetchExposureAging(s), { refreshMs: MINUTE });
}

/** Filters are part of the query key, so any change triggers a fresh API request. */
export function useDiscrepancies(filters: DiscrepancyFilters, options: { refreshMs?: number } = {}) {
  const key = `discrepancies:${filters.status}:${filters.severity ?? ''}:${filters.psp_name ?? ''}:${filters.limit}:${filters.offset}`;
  return useQuery(key, (s) => fetchDiscrepancies(filters, s), options);
}

export function useDiscrepancyEvents(id: string | null) {
  return useQuery(`discrepancy-events:${id}`, (s) => fetchDiscrepancyEvents(id as string, s), { enabled: id !== null });
}

export function useDailyReports(params: { limit: number; offset: number }) {
  return useQuery(`reports:${params.limit}:${params.offset}`, (s) => fetchDailyReports(params, s));
}

export function useTransactions(filters: TransactionFilters) {
  const key = `transactions:${JSON.stringify(filters)}`;
  return useQuery(key, (s) => fetchTransactions(filters, s));
}

export function useTransaction(id: string | null) {
  return useQuery(`transaction:${id}`, (s) => fetchTransaction(id as string, s), { enabled: id !== null });
}

export function usePairs(filters: PairFilters) {
  return useQuery(`pairs:${JSON.stringify(filters)}`, (s) => fetchPairs(filters, s));
}

export function usePair(id: string | null) {
  return useQuery(`pair:${id}`, (s) => fetchPair(id as string, s), { enabled: id !== null });
}

export function usePipelineRuns(params: { limit: number; flow_name?: string }, options: { refreshMs?: number } = {}) {
  return useQuery(`pipeline-runs:${params.limit}:${params.flow_name ?? ''}`, (s) => fetchPipelineRuns(params, s), {
    refreshMs: options.refreshMs ?? 30_000,
  });
}

export function useSearch(q: string) {
  const term = q.trim();
  return useQuery(`search:${term}`, (s) => fetchSearch(term, s), { enabled: term.length >= MIN_SEARCH_LENGTH });
}

// ─── Small client utilities ──────────────────────────────────────────────────

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

/** A value that only settles after `delayMs` without changes. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** True when the viewport is at least `minWidth` px wide; false during SSR. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
