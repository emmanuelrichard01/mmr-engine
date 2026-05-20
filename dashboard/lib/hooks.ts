// ─── Data Hooks ──────────────────────────────────────────────────────────────
// Custom React hooks that try the live API first, then fall back to demo data.
// Each hook returns { data, isLoading, error, isUsingDemoData }.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchReconciliationSummary,
  fetchDiscrepancies as apiFetchDiscrepancies,
  fetchExposure,
  fetchHealthReady,
  resolveDiscrepancy as apiResolveDiscrepancy,
  isAPIReachable,
  type ReconciliationSummary,
  type APIDiscrepancy,
  type ExposureResponse,
  type HealthCheck,
} from './api';
import {
  getKPISummary,
  getDailySummaries,
  getDiscrepancies as getDemoDiscrepancies,
  getPSPHealth,
  getFXRates,
  type KPISummary,
  type DailySummary,
  type Discrepancy,
  type PSPHealth,
  type FXRate,
} from './demo-data';

// ─── Generic Data Hook ───────────────────────────────────────────────────────

interface UseDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  isUsingDemoData: boolean;
  refetch: () => void;
}

function useData<T>(
  fetcher: () => Promise<T>,
  fallback: () => T,
  refreshInterval?: number
): UseDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isUsingDemoData, setIsUsingDemoData] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setIsUsingDemoData(false);
      setError(null);
    } catch (err) {
      // Fall back to demo data
      setData(fallback());
      setIsUsingDemoData(true);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();

    if (refreshInterval) {
      intervalRef.current = setInterval(fetchData, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData, refreshInterval]);

  return { data, isLoading, error, isUsingDemoData, refetch: fetchData };
}

// ─── API Connectivity ────────────────────────────────────────────────────────

export function useAPIStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    isAPIReachable().then(setIsConnected);
    const interval = setInterval(() => {
      isAPIReachable().then(setIsConnected);
    }, 30_000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  return isConnected;
}

// ─── KPI Summary ─────────────────────────────────────────────────────────────

export function useKPISummary(): UseDataResult<KPISummary> {
  return useData<KPISummary>(
    async () => {
      // Try to build KPI from API endpoints
      const [summary, exposure] = await Promise.all([
        fetchReconciliationSummary(),
        fetchExposure(),
      ]);

      const demoSummaries = getDailySummaries();
      const recentSummaries = demoSummaries.slice(-7);

      return {
        matchRate: {
          value: summary.match_rate_pct,
          delta: 0, // Would need yesterday's data from API
          trend: recentSummaries.map((s) => s.matchRate),
        },
        openExposure: {
          value: exposure.total_open_exposure_ngn,
          delta: 0,
          trend: recentSummaries.map((s) => s.exposure),
        },
        pendingIssues: {
          value: summary.discrepancies.reduce((sum, d) => sum + d.count, 0),
          delta: 0,
          trend: recentSummaries.map((s) => s.discrepancyCount),
        },
        txnsToday: {
          value: summary.total_transactions,
          delta: 0,
          trend: recentSummaries.map((s) => s.transactionsProcessed),
        },
      };
    },
    () => getKPISummary(),
    30_000 // Refresh every 30 seconds
  );
}

// ─── Daily Summaries ─────────────────────────────────────────────────────────

export function useDailySummaries(): UseDataResult<DailySummary[]> {
  return useData<DailySummary[]>(
    async () => {
      // Daily summaries require aggregation not available from API yet
      // Fall through to demo data
      throw new Error('Daily summaries API not yet implemented');
    },
    () => getDailySummaries()
  );
}

// ─── Discrepancies ───────────────────────────────────────────────────────────

export function useDiscrepancies(filters?: {
  severity?: string;
  status?: string;
  psp?: string;
}): UseDataResult<Discrepancy[]> {
  return useData<Discrepancy[]>(
    async () => {
      const result = await apiFetchDiscrepancies({
        severity: filters?.severity !== 'all' ? filters?.severity : undefined,
        status: filters?.status !== 'all' ? filters?.status : undefined,
        limit: 100,
      });

      // Map API response to dashboard Discrepancy type
      return result.discrepancies.map((d) => ({
        id: `DIS-${String(d.id).padStart(4, '0')}`,
        type: d.discrepancy_type as Discrepancy['type'],
        severity: d.severity as Discrepancy['severity'],
        psp: d.psp_name as Discrepancy['psp'],
        amount: d.estimated_exposure_ngn,
        currency: 'NGN',
        reference: d.psp_transaction_ref || `TXN-${d.transaction_id}`,
        beneficiaryName: '••• (masked)',
        status: d.status as Discrepancy['status'],
        createdAt: d.detected_at,
        ageHours: Math.round(
          (Date.now() - new Date(d.detected_at).getTime()) / 3600000
        ),
      }));
    },
    () => {
      let items = getDemoDiscrepancies();
      if (filters?.severity && filters.severity !== 'all') {
        items = items.filter((d) => d.severity === filters.severity);
      }
      if (filters?.status && filters.status !== 'all') {
        items = items.filter((d) => d.status === filters.status);
      }
      if (filters?.psp && filters.psp !== 'all') {
        items = items.filter((d) => d.psp === filters.psp);
      }
      return items;
    }
  );
}

// ─── PSP Health ──────────────────────────────────────────────────────────────

export function usePSPHealth(): UseDataResult<PSPHealth[]> {
  return useData<PSPHealth[]>(
    async () => {
      const health = await fetchHealthReady();
      // Map health check to PSPHealth format
      // The health endpoint doesn't have per-PSP data yet
      // Fall through to demo data
      if (health.status !== 'healthy') {
        throw new Error('Service degraded');
      }
      throw new Error('Per-PSP health API not yet implemented');
    },
    () => getPSPHealth(),
    60_000 // Refresh every 60 seconds
  );
}

// ─── Exposure ────────────────────────────────────────────────────────────────

export function useExposure(): UseDataResult<ExposureResponse> {
  return useData<ExposureResponse>(
    () => fetchExposure(),
    () => ({
      total_open_exposure_ngn: 0,
      by_psp_and_type: [],
      generated_at: new Date().toISOString(),
    }),
    60_000
  );
}

// ─── FX Rates ────────────────────────────────────────────────────────────────

export function useFXRates(): UseDataResult<FXRate[]> {
  return useData<FXRate[]>(
    async () => {
      // FX rate API not yet exposed via REST
      throw new Error('FX rate API not yet implemented');
    },
    () => getFXRates()
  );
}

// ─── Resolve Discrepancy ─────────────────────────────────────────────────────

export function useResolveDiscrepancy() {
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<Error | null>(null);

  const resolve = useCallback(
    async (id: number, note: string): Promise<boolean> => {
      setIsResolving(true);
      setResolveError(null);
      try {
        await apiResolveDiscrepancy(id, note);
        return true;
      } catch (err) {
        setResolveError(
          err instanceof Error ? err : new Error(String(err))
        );
        return false;
      } finally {
        setIsResolving(false);
      }
    },
    []
  );

  return { resolve, isResolving, resolveError };
}
