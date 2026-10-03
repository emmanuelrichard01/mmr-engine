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

/** Every list endpoint caps `limit` at 200. */
export const MAX_PAGE_SIZE = 200;

// ─── Shared vocabularies ─────────────────────────────────────────────────────

export type DiscrepancyStatus = 'open' | 'under_review' | 'resolved' | 'false_positive' | 'escalated';

export const DISCREPANCY_STATUSES: DiscrepancyStatus[] = [
  'open',
  'under_review',
  'escalated',
  'resolved',
  'false_positive',
];

/** Statuses that can still be resolved. */
export const ACTIONABLE_STATUSES: DiscrepancyStatus[] = ['open', 'under_review', 'escalated'];

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export const PSPS = ['paystack', 'flutterwave'] as const;
export type PspName = (typeof PSPS)[number];

export type TransactionType = 'credit' | 'debit' | 'reversal';
export const TRANSACTION_TYPES: TransactionType[] = ['credit', 'debit', 'reversal'];

export type SettlementStatus = 'pending' | 'settled' | 'failed' | 'reversed';
export const SETTLEMENT_STATUSES: SettlementStatus[] = ['pending', 'settled', 'failed', 'reversed'];

export type MatchStatus = 'matched' | 'unmatched';

export type PairStatus = 'matched' | 'discrepancy' | 'under_review' | 'resolved' | 'false_positive';
export const PAIR_STATUSES: PairStatus[] = ['matched', 'discrepancy', 'under_review', 'resolved', 'false_positive'];

export type MatchStrategy = 'exact_primary' | 'probabilistic_secondary' | 'manual';

export type PipelineStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgingBucket = '0-1d' | '1-3d' | '3-7d' | '7d+';
export const AGING_BUCKETS: AgingBucket[] = ['0-1d', '1-3d', '3-7d', '7d+'];

// ─── Contract types ──────────────────────────────────────────────────────────

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
  volume_ngn: DecimalString;
  discrepancies_raised: number;
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
  id: string;
  transaction_id: string;
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
  discrepancy_id: string;
  events: DiscrepancyEvent[];
}

export interface ResolveResponse {
  discrepancy_id: string;
  status: ResolveOutcome;
  resolved_by: string;
}

export interface BulkResolveResponse {
  resolved: string[];
  skipped: { id: string; reason: 'not_found' | 'already_closed' | string }[];
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

export interface AgingBucketRow {
  bucket: AgingBucket;
  count: number;
  exposure_ngn: DecimalString;
}

export interface ExposureAgingResponse {
  buckets: AgingBucketRow[];
  by_psp: { psp_name: string; buckets: AgingBucketRow[] }[];
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

export interface TransactionSummary {
  id: string;
  psp_name: string;
  psp_transaction_ref: string;
  transaction_type: TransactionType;
  amount_ngn: DecimalString;
  amount_raw: DecimalString;
  currency_raw: string;
  settlement_status: SettlementStatus | string;
  initiated_at: string;
  settled_at: string | null;
  expected_settlement_at: string | null;
  beneficiary_name_masked: string | null;
  beneficiary_bank_name: string | null;
  match_status: MatchStatus;
  pair_id: string | null;
  open_discrepancies: number;
}

export interface TransactionListResponse {
  transactions: TransactionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransactionFilters {
  q?: string;
  psp_name?: string;
  transaction_type?: TransactionType;
  match_status?: MatchStatus;
  settlement_status?: SettlementStatus;
  date_from?: string;
  date_to?: string;
  limit: number;
  offset: number;
}

export interface TransactionDetail extends TransactionSummary {
  psp_event_type: string;
  beneficiary_account_masked: string | null;
  narration: string | null;
  fx_rate_applied: DecimalString | null;
  idempotency_key: string;
  created_at: string;
}

export interface LinkedDiscrepancy {
  id: string;
  discrepancy_type: string;
  severity: Severity | null;
  status: DiscrepancyStatus;
  estimated_exposure_ngn: DecimalString;
  detected_at: string;
}

export interface Counterpart {
  id: string;
  psp_name: string;
  psp_transaction_ref: string;
  transaction_type: TransactionType;
  amount_ngn: DecimalString;
  initiated_at: string;
}

export interface Lineage {
  kafka_topic: string | null;
  kafka_partition: number | null;
  kafka_offset: number | null;
  bronze_received_at: string | null;
  bronze_file_path: string | null;
  run_id: string | null;
}

export interface TransactionDetailResponse {
  transaction: TransactionDetail;
  pair: null | {
    id: string;
    match_strategy: MatchStrategy | string;
    confidence_score: string | number | null;
    status: PairStatus | string;
    amount_delta_ngn: DecimalString | null;
    match_evidence: Record<string, unknown> | null;
    counterpart: Counterpart;
  };
  discrepancies: LinkedDiscrepancy[];
  lineage: Lineage;
}

export interface PairListItem {
  id: string;
  transaction_a_id: string;
  transaction_b_id: string;
  match_strategy: MatchStrategy | string;
  confidence_score: string | number | null;
  status: PairStatus | string;
  amount_a_ngn: DecimalString | null;
  amount_b_ngn: DecimalString | null;
  amount_delta_ngn: DecimalString | null;
  is_within_fx_threshold: boolean | null;
  psp_a: string;
  psp_b: string;
  created_at: string;
}

export interface PairListResponse {
  pairs: PairListItem[];
  limit: number;
  offset: number;
  count: number;
}

export interface PairFilters {
  status?: PairStatus;
  psp_name?: string;
  limit: number;
  offset: number;
}

export interface PairDetailResponse {
  pair: {
    id: string;
    match_strategy: MatchStrategy | string;
    confidence_score: string | number | null;
    status: PairStatus | string;
    amount_a_ngn: DecimalString | null;
    amount_b_ngn: DecimalString | null;
    amount_delta_ngn: DecimalString | null;
    is_within_fx_threshold: boolean | null;
    match_evidence: Record<string, unknown> | null;
    created_at: string;
  };
  a: TransactionSummary;
  b: TransactionSummary;
  discrepancies: LinkedDiscrepancy[];
}

export interface PipelineRun {
  id: string;
  flow_name: string;
  status: PipelineStatus | string;
  triggered_by: string | null;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  records_processed: number;
  records_failed: number;
  error_message: string | null;
}

export interface PipelineRunsResponse {
  runs: PipelineRun[];
}

export type SearchKind = 'transaction' | 'discrepancy' | 'pair';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

/** The API only searches from 3 characters. */
export const MIN_SEARCH_LENGTH = 3;

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

export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

export function fetchDiscrepancies(filters: DiscrepancyFilters, signal?: AbortSignal): Promise<DiscrepancyListResponse> {
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
export const MAX_BULK_RESOLVE = 100;

export function resolveDiscrepancy(id: string, resolutionNote: string, outcome: ResolveOutcome = 'resolved'): Promise<ResolveResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.resolve(id, resolutionNote, outcome));
  return postJson(`/v1/reconciliation/discrepancies/${encodeURIComponent(id)}/resolve`, {
    resolution_note: resolutionNote,
    outcome,
  });
}

export function bulkResolveDiscrepancies(ids: string[], resolutionNote: string, outcome: ResolveOutcome): Promise<BulkResolveResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.bulkResolve(ids, resolutionNote, outcome));
  return postJson('/v1/reconciliation/discrepancies/bulk-resolve', { ids, resolution_note: resolutionNote, outcome });
}

export function fetchDiscrepancyEvents(id: string, signal?: AbortSignal): Promise<DiscrepancyEventsResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.discrepancyEvents(id));
  return request(`/v1/reconciliation/discrepancies/${encodeURIComponent(id)}/events`, {}, signal);
}

export function fetchExposure(signal?: AbortSignal): Promise<ExposureResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.exposure());
  return request('/v1/reconciliation/exposure', {}, signal);
}

export function fetchExposureAging(signal?: AbortSignal): Promise<ExposureAgingResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.exposureAging());
  return request('/v1/reconciliation/exposure/aging', {}, signal);
}

export function fetchDailyReports(params: { limit: number; offset: number }, signal?: AbortSignal): Promise<DailyReportsResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.dailyReports(params));
  return request(`/v1/reports/daily${qs(params)}`, {}, signal);
}

export function fetchTransactions(filters: TransactionFilters, signal?: AbortSignal): Promise<TransactionListResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.transactions(filters));
  return request(`/v1/reconciliation/transactions${qs({ ...filters })}`, {}, signal);
}

export function fetchTransaction(id: string, signal?: AbortSignal): Promise<TransactionDetailResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.transaction(id));
  return request(`/v1/reconciliation/transactions/${encodeURIComponent(id)}`, {}, signal);
}

export function fetchPairs(filters: PairFilters, signal?: AbortSignal): Promise<PairListResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.pairs(filters));
  return request(`/v1/reconciliation/pairs${qs({ ...filters })}`, {}, signal);
}

export function fetchPair(id: string, signal?: AbortSignal): Promise<PairDetailResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.pair(id));
  return request(`/v1/reconciliation/pairs/${encodeURIComponent(id)}`, {}, signal);
}

export function fetchPipelineRuns(params: { limit: number; flow_name?: string }, signal?: AbortSignal): Promise<PipelineRunsResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.pipelineRuns(params));
  return request(`/v1/system/pipeline-runs${qs(params)}`, {}, signal);
}

export function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResponse> {
  if (DEMO_MODE) return loadDemo().then((d) => d.search(q));
  return request(`/v1/search${qs({ q })}`, {}, signal);
}
