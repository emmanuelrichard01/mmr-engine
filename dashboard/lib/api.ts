// ─── MMR API client ──────────────────────────────────────────────────────────
// The browser only ever talks to the dashboard's own server-side proxy at
// /api/mmr/*, which forwards to MMR_API_URL and injects the API key from server
// env (see app/api/mmr/[...path]/route.ts). No secret reaches the client bundle.
//
// There is no silent fallback: a failed request surfaces as an ApiError. Demo
// fixtures are served only when the build sets NEXT_PUBLIC_DEMO_MODE=true, and
// every page then shows a persistent "Demo data" banner.

import type { DecimalString } from './money';
/** Demo fixtures are loaded lazily, only when DEMO_MODE is on. */
const loadDemo = () => import('./demo-data');

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

const PROXY_BASE = '/api/mmr';

// ─── Contract types ──────────────────────────────────────────────────────────

export type DiscrepancyStatus =
  | 'open'
  | 'under_review'
  | 'resolved'
  | 'false_positive'
  | 'escalated';

export const DISCREPANCY_STATUSES: DiscrepancyStatus[] = [
  'open',
  'under_review',
  'escalated',
  'resolved',
  'false_positive',
];

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export const PSPS = ['paystack', 'flutterwave'] as const;

export interface ServiceCheck {
  status: string;
  latency_ms?: number;
  error?: string;
  [key: string]: unknown;
}

export interface ReadinessBody {
  status: 'healthy' | 'degraded' | string;
  version?: string;
  checks?: Record<string, ServiceCheck>;
}

export interface ReconciliationSummary {
  report_date: string;
  total_transactions: number;
  matched: number;
  unmatched: number;
  match_rate_pct: number | null;
  discrepancies: {
    discrepancy_type: string;
    count: number;
    total_exposure: DecimalString;
  }[];
  generated_at: string;
}

export interface TrendDay {
  date: string;
  total: number;
  matched: number;
  /** Null when there were no transactions that day. */
  match_rate_pct: number | null;
}

export interface TrendResponse {
  days: TrendDay[];
}

export interface PspHealth {
  psp_name: string;
  events_24h: number;
  last_event_at: string | null;
  match_rate_pct_7d: number | null;
  open_discrepancies: number;
  open_exposure_ngn: DecimalString;
}

export interface PspHealthResponse {
  psps: PspHealth[];
}

export interface Discrepancy {
  id: number;
  transaction_id: number;
  discrepancy_type: string;
  severity: Severity | null;
  estimated_exposure_ngn: DecimalString;
  amount_ngn: DecimalString;
  evidence: Record<string, unknown> | null;
  status: DiscrepancyStatus;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note?: string | null;
  psp_name: string;
  psp_transaction_ref: string | null;
}

export interface DiscrepancyListResponse {
  discrepancies: Discrepancy[];
  limit: number;
  offset: number;
  count: number;
}

export interface DiscrepancyFilters {
  /** "all" returns every status; the API default is "open". */
  status: DiscrepancyStatus | 'all';
  severity?: Severity;
  psp_name?: string;
  limit: number;
  offset: number;
}

export type ResolveOutcome = 'resolved' | 'false_positive';

export type DiscrepancyEventAction =
  | 'raised'
  | 'severity_changed'
  | 'resolved'
  | 'marked_false_positive'
  | 'escalated'
  | 'reopened';

export interface DiscrepancyEvent {
  action: DiscrepancyEventAction | string;
  from_status: string | null;
  to_status: string | null;
  actor: string | null;
  note: string | null;
  occurred_at: string;
}

export interface DiscrepancyEventsResponse {
  discrepancy_id: number;
  events: DiscrepancyEvent[];
}

export interface ResolveResponse {
  discrepancy_id: number;
  status: ResolveOutcome;
  resolved_by: string;
}

export interface ExposureEntry {
  psp_name: string;
  discrepancy_type: string;
  open_count: number;
  total_exposure_ngn: DecimalString;
}

export interface ExposureResponse {
  total_open_exposure_ngn: DecimalString;
  by_psp_and_type: ExposureEntry[];
  generated_at: string;
}

export interface DailyReport {
  report_date: string;
  total_transactions: number;
  total_volume_ngn: DecimalString;
  match_rate_pct: number | null;
  cross_border_count: number;
  suspicious_flags: number;
  open_discrepancies: number;
  total_exposure_ngn: DecimalString;
  status: string;
  generated_at: string;
}

export interface DailyReportsResponse {
  reports: DailyReport[];
  count: number;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(status ? `${status}: ${detail}` : detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI returns `detail` as a string or as a list of validation errors. */
function extractDetail(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : null))
        .filter(Boolean);
      if (msgs.length) return msgs.join('; ');
    }
  }
  return fallback;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new ApiError(0, 'Request timed out');
  }
  if (err instanceof Error) return new ApiError(0, err.message || 'Network error');
  return new ApiError(0, String(err));
}

// ─── Fetch wrapper ───────────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractDetail(body, res.statusText || 'Request failed'));
  }
  if (body === null) throw new ApiError(res.status, 'Response was not valid JSON');
  return body as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export interface ReadinessResult {
  /** HTTP status from the API (200 or 503), or the proxy's own error status. */
  httpStatus: number;
  body: ReadinessBody | null;
  checkedAt: number;
}

/**
 * /health/ready answers 200 when every dependency is up and 503 otherwise;
 * both carry the per-service JSON, so a 503 is a result, not an exception.
 * Anything else (proxy 502/504, network failure) throws.
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResult> {
  if (DEMO_MODE) return { httpStatus: 200, body: (await loadDemo()).readiness(), checkedAt: Date.now() };
  const res = await fetch(`${PROXY_BASE}/health/ready`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 200 || res.status === 503) {
    return { httpStatus: res.status, body: (body as ReadinessBody) ?? null, checkedAt: Date.now() };
  }
  throw new ApiError(res.status, extractDetail(body, res.statusText || 'Readiness check failed'));
}

export function fetchSummary(signal?: AbortSignal, reportDate?: string): Promise<ReconciliationSummary> {
  if (DEMO_MODE) return loadDemo().then((d) => d.summary());
  return request(`/v1/reconciliation/summary${qs({ report_date: reportDate })}`, {}, signal);
}

export function fetchTrend(days: number, signal?: AbortSignal): Promise<TrendResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.trend(days));
  return request(`/v1/reconciliation/trend${qs({ days })}`, {}, signal);
}

export function fetchPspHealth(signal?: AbortSignal): Promise<PspHealthResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.pspHealth());
  return request('/v1/reconciliation/psp-health', {}, signal);
}

export function fetchDiscrepancies(
  filters: DiscrepancyFilters,
  signal?: AbortSignal,
): Promise<DiscrepancyListResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.discrepancies(filters));
  return request(
    `/v1/reconciliation/discrepancies${qs({
      status: filters.status,
      severity: filters.severity,
      psp_name: filters.psp_name,
      limit: filters.limit,
      offset: filters.offset,
    })}`,
    {},
    signal,
  );
}

export const MIN_RESOLUTION_NOTE = 10;

export function resolveDiscrepancy(
  id: number,
  resolutionNote: string,
  outcome: ResolveOutcome = 'resolved',
): Promise<ResolveResponse> {
  if (DEMO_MODE) {
    return Promise.reject(
      new ApiError(0, 'Resolving is disabled in demo mode — there is no engine to write to.'),
    );
  }
  return request(`/v1/reconciliation/discrepancies/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution_note: resolutionNote, outcome }),
  });
}

export function fetchDiscrepancyEvents(id: number, signal?: AbortSignal): Promise<DiscrepancyEventsResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.discrepancyEvents(id));
  return request(`/v1/reconciliation/discrepancies/${id}/events`, {}, signal);
}

export function fetchExposure(signal?: AbortSignal): Promise<ExposureResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.exposure());
  return request('/v1/reconciliation/exposure', {}, signal);
}

export function fetchDailyReports(
  params: { limit: number; offset: number },
  signal?: AbortSignal,
): Promise<DailyReportsResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.dailyReports(params));
  return request(`/v1/reports/daily${qs(params)}`, {}, signal);
}
