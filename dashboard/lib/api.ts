// ─── MMR API Client ──────────────────────────────────────────────────────────
// Typed fetch wrapper for the FastAPI backend.
// Falls back to demo data when the API is unreachable.

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReconciliationSummary {
  report_date: string;
  total_transactions: number;
  matched: number;
  unmatched: number;
  match_rate_pct: number;
  discrepancies: {
    discrepancy_type: string;
    count: number;
    total_exposure: number;
  }[];
  generated_at: string;
}

export interface ReconciliationPair {
  id: number;
  transaction_a_id: number;
  transaction_b_id: number;
  match_strategy: string;
  confidence_score: number;
  amount_a_ngn: number;
  amount_delta_ngn: number;
  is_within_fx_threshold: boolean;
  status: string;
  created_at: string;
  psp_a: string;
  psp_b: string;
}

export interface APIDiscrepancy {
  id: number;
  transaction_id: number;
  discrepancy_type: string;
  severity: string;
  estimated_exposure_ngn: number;
  evidence: Record<string, unknown>;
  status: string;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  psp_name: string;
  amount_ngn: number;
  psp_transaction_ref: string;
}

export interface ExposureEntry {
  psp_name: string;
  discrepancy_type: string;
  open_count: number;
  total_exposure_ngn: number;
}

export interface ExposureResponse {
  total_open_exposure_ngn: number;
  by_psp_and_type: ExposureEntry[];
  generated_at: string;
}

export interface HealthCheck {
  status: string;
  version: string;
  checks: Record<
    string,
    {
      status: string;
      latency_ms?: number;
      error?: string;
      topics?: number;
      bronze_bucket_exists?: boolean;
    }
  >;
}

export interface WebhookAcceptedResponse {
  status: string;
  is_new: boolean;
  idempotency_key?: string;
}

// ─── Fetch Wrapper ───────────────────────────────────────────────────────────

export class APIError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API Error ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  // Add API key if available
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(10_000), // 10s timeout
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new APIError(response.status, body.detail || body.message || response.statusText);
  }

  return response.json();
}

// ─── Endpoint Functions ──────────────────────────────────────────────────────

export async function fetchReconciliationSummary(
  date?: string
): Promise<ReconciliationSummary> {
  const params = date ? `?report_date=${date}` : '';
  return apiFetch<ReconciliationSummary>(
    `/v1/reconciliation/summary${params}`
  );
}

export async function fetchReconciliationPairs(params?: {
  status?: string;
  psp_name?: string;
  limit?: number;
  offset?: number;
}): Promise<{ pairs: ReconciliationPair[]; limit: number; offset: number; count: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.psp_name) searchParams.set('psp_name', params.psp_name);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();
  return apiFetch(`/v1/reconciliation/pairs${qs ? `?${qs}` : ''}`);
}

export async function fetchDiscrepancies(params?: {
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}): Promise<{ discrepancies: APIDiscrepancy[]; limit: number; offset: number; count: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.severity) searchParams.set('severity', params.severity);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();
  return apiFetch(`/v1/reconciliation/discrepancies${qs ? `?${qs}` : ''}`);
}

export async function resolveDiscrepancy(
  id: number,
  resolutionNote: string
): Promise<{ discrepancy_id: number; status: string; resolved_by: string }> {
  return apiFetch(
    `/v1/reconciliation/discrepancies/${id}/resolve?resolution_note=${encodeURIComponent(resolutionNote)}`,
    { method: 'POST' }
  );
}

export async function fetchExposure(): Promise<ExposureResponse> {
  return apiFetch<ExposureResponse>('/v1/reconciliation/exposure');
}

export async function fetchHealthReady(): Promise<HealthCheck> {
  return apiFetch<HealthCheck>('/health/ready');
}

// ─── Connection Check ────────────────────────────────────────────────────────

export async function isAPIReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
