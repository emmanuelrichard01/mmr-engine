// ─── Demo fixtures ───────────────────────────────────────────────────────────
// Used ONLY when the dashboard is built with NEXT_PUBLIC_DEMO_MODE=true, in
// which case every page carries a persistent "Demo data" banner. These are
// hand-written, deterministic fixtures in the exact API contract shape. They
// are not samples of real traffic and must never be presented as such.

import type {
  DiscrepancyEventsResponse,
  DailyReportsResponse,
  Discrepancy,
  DiscrepancyFilters,
  DiscrepancyListResponse,
  ExposureResponse,
  PspHealthResponse,
  ReadinessBody,
  ReconciliationSummary,
  TrendResponse,
} from './api';
import { koboToDecimalString, sumKobo, toKobo } from './money';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function ymdAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

/** Small deterministic wobble so charts are not flat lines. */
function wobble(i: number, amplitude: number): number {
  return Math.round(Math.sin(i * 1.7) * amplitude + Math.cos(i * 0.6) * amplitude * 0.5);
}

const RAW: (Omit<Discrepancy, 'detected_at' | 'resolved_at'> & { ageHours: number; resolvedAgoHours?: number })[] = [
  { id: 1042, transaction_id: 88123, discrepancy_type: 'duplicate_credit', severity: 'critical', estimated_exposure_ngn: '250000.00', amount_ngn: '250000.00', evidence: { duplicate_of: 88121, window_seconds: 41 }, status: 'open', resolved_by: null, psp_name: 'paystack', psp_transaction_ref: 'DEMO-PSK-000412', ageHours: 5 },
  { id: 1039, transaction_id: 88007, discrepancy_type: 'missing_settlement', severity: 'high', estimated_exposure_ngn: '182500.00', amount_ngn: '182500.00', evidence: { expected_settlement_by: 'T+1', webhook_seen: true }, status: 'open', resolved_by: null, psp_name: 'flutterwave', psp_transaction_ref: 'DEMO-FLW-000233', ageHours: 31 },
  { id: 1037, transaction_id: 87950, discrepancy_type: 'amount_mismatch', severity: 'high', estimated_exposure_ngn: '4750.00', amount_ngn: '95000.00', evidence: { amount_a_ngn: '95000.00', amount_b_ngn: '90250.00' }, status: 'under_review', resolved_by: null, psp_name: 'paystack', psp_transaction_ref: 'DEMO-PSK-000398', ageHours: 52 },
  { id: 1031, transaction_id: 87702, discrepancy_type: 'late_settlement', severity: 'medium', estimated_exposure_ngn: '61200.00', amount_ngn: '61200.00', evidence: { hours_late: 19 }, status: 'open', resolved_by: null, psp_name: 'flutterwave', psp_transaction_ref: 'DEMO-FLW-000219', ageHours: 20 },
  { id: 1028, transaction_id: 87655, discrepancy_type: 'amount_mismatch', severity: 'medium', estimated_exposure_ngn: '310.50', amount_ngn: '31050.00', evidence: { amount_a_ngn: '31050.00', amount_b_ngn: '30739.50' }, status: 'escalated', resolved_by: null, psp_name: 'paystack', psp_transaction_ref: 'DEMO-PSK-000377', ageHours: 70 },
  { id: 1024, transaction_id: 87511, discrepancy_type: 'fx_variance', severity: 'low', estimated_exposure_ngn: '125.75', amount_ngn: '48000.00', evidence: { variance_pct: '0.26' }, status: 'open', resolved_by: null, psp_name: 'flutterwave', psp_transaction_ref: 'DEMO-FLW-000201', ageHours: 9 },
  { id: 1019, transaction_id: 87340, discrepancy_type: 'missing_settlement', severity: null, estimated_exposure_ngn: '15000.00', amount_ngn: '15000.00', evidence: {}, status: 'open', resolved_by: null, psp_name: 'paystack', psp_transaction_ref: 'DEMO-PSK-000351', ageHours: 3 },
  { id: 1011, transaction_id: 86998, discrepancy_type: 'late_settlement', severity: 'low', estimated_exposure_ngn: '22000.00', amount_ngn: '22000.00', evidence: { hours_late: 2 }, status: 'resolved', resolved_by: 'demo-analyst', psp_name: 'paystack', psp_transaction_ref: 'DEMO-PSK-000322', ageHours: 96, resolvedAgoHours: 80 },
  { id: 1007, transaction_id: 86870, discrepancy_type: 'fx_variance', severity: 'low', estimated_exposure_ngn: '40.00', amount_ngn: '12000.00', evidence: { variance_pct: '0.33' }, status: 'false_positive', resolved_by: 'demo-analyst', psp_name: 'flutterwave', psp_transaction_ref: 'DEMO-FLW-000177', ageHours: 120, resolvedAgoHours: 100 },
];

function allDiscrepancies(): Discrepancy[] {
  return RAW.map(({ ageHours, resolvedAgoHours, ...d }) => ({
    ...d,
    detected_at: isoAgo(ageHours * HOUR),
    resolved_at: resolvedAgoHours === undefined ? null : isoAgo(resolvedAgoHours * HOUR),
    resolution_note:
      d.status === 'resolved'
        ? 'Demo fixture: settlement located in the next PSP payout batch.'
        : d.status === 'false_positive'
          ? 'Demo fixture: variance within the configured FX tolerance.'
          : null,
  }));
}

/** Audit trail derived from the fixture's own fields — nothing beyond what the row states. */
export function discrepancyEvents(id: number): DiscrepancyEventsResponse {
  const d = allDiscrepancies().find((row) => row.id === id);
  if (!d) return { discrepancy_id: id, events: [] };
  const events: DiscrepancyEventsResponse['events'] = [
    { action: 'raised', from_status: null, to_status: 'open', actor: 'engine', note: null, occurred_at: d.detected_at },
  ];
  if (d.status === 'escalated') {
    events.push({
      action: 'escalated',
      from_status: 'open',
      to_status: 'escalated',
      actor: 'demo-analyst',
      note: null,
      occurred_at: new Date(Date.parse(d.detected_at) + 2 * HOUR).toISOString(),
    });
  }
  if (d.resolved_at) {
    events.push({
      action: d.status === 'false_positive' ? 'marked_false_positive' : 'resolved',
      from_status: 'open',
      to_status: d.status,
      actor: d.resolved_by,
      note: d.resolution_note ?? null,
      occurred_at: d.resolved_at,
    });
  }
  return { discrepancy_id: id, events };
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function discrepancies(filters: DiscrepancyFilters): DiscrepancyListResponse {
  const rows = allDiscrepancies()
    .filter((d) => filters.status === 'all' || d.status === filters.status)
    .filter((d) => !filters.severity || d.severity === filters.severity)
    .filter((d) => !filters.psp_name || d.psp_name === filters.psp_name)
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity ?? ''] ?? 4) - (SEVERITY_ORDER[b.severity ?? ''] ?? 4) ||
        b.detected_at.localeCompare(a.detected_at),
    );
  const page = rows.slice(filters.offset, filters.offset + filters.limit);
  return { discrepancies: page, limit: filters.limit, offset: filters.offset, count: page.length };
}

function openRows(): Discrepancy[] {
  return allDiscrepancies().filter((d) => d.status !== 'resolved' && d.status !== 'false_positive');
}

export function exposure(): ExposureResponse {
  const groups = new Map<string, Discrepancy[]>();
  for (const d of openRows()) {
    const key = `${d.psp_name}|${d.discrepancy_type}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const by = [...groups.entries()].map(([key, rows]) => {
    const [psp_name, discrepancy_type] = key.split('|');
    return {
      psp_name,
      discrepancy_type,
      open_count: rows.length,
      total_exposure_ngn: koboToDecimalString(sumKobo(rows.map((r) => r.estimated_exposure_ngn))),
    };
  });
  by.sort((a, b) => Number((toKobo(b.total_exposure_ngn) ?? BigInt(0)) - (toKobo(a.total_exposure_ngn) ?? BigInt(0))));
  return {
    total_open_exposure_ngn: koboToDecimalString(sumKobo(openRows().map((r) => r.estimated_exposure_ngn))),
    by_psp_and_type: by,
    generated_at: isoAgo(0),
  };
}

export function trend(days: number): TrendResponse {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const total = 1180 + wobble(i, 90);
    const unmatched = 14 + Math.abs(wobble(i + 3, 9));
    const matched = total - unmatched;
    out.push({
      date: ymdAgo(i),
      total,
      matched,
      match_rate_pct: Math.round((matched / total) * 10_000) / 100,
    });
  }
  return { days: out };
}

export function summary(): ReconciliationSummary {
  const today = trend(1).days[0];
  const byType = new Map<string, Discrepancy[]>();
  for (const d of openRows()) byType.set(d.discrepancy_type, [...(byType.get(d.discrepancy_type) ?? []), d]);
  return {
    report_date: today.date,
    total_transactions: today.total,
    matched: today.matched,
    unmatched: today.total - today.matched,
    match_rate_pct: today.match_rate_pct,
    discrepancies: [...byType.entries()].map(([discrepancy_type, rows]) => ({
      discrepancy_type,
      count: rows.length,
      total_exposure: koboToDecimalString(sumKobo(rows.map((r) => r.estimated_exposure_ngn))),
    })),
    generated_at: isoAgo(4 * 60_000),
  };
}

export function pspHealth(): PspHealthResponse {
  const open = openRows();
  return {
    psps: [
      { psp: 'paystack', events: 742, lastMs: 2 * 60_000, rate: 98.4 },
      { psp: 'flutterwave', events: 455, lastMs: 11 * 60_000, rate: 97.1 },
    ].map(({ psp, events, lastMs, rate }) => {
      const rows = open.filter((d) => d.psp_name === psp);
      return {
        psp_name: psp,
        events_24h: events,
        last_event_at: isoAgo(lastMs),
        match_rate_pct_7d: rate,
        open_discrepancies: rows.length,
        open_exposure_ngn: koboToDecimalString(sumKobo(rows.map((r) => r.estimated_exposure_ngn))),
      };
    }),
  };
}

export function dailyReports({ limit, offset }: { limit: number; offset: number }): DailyReportsResponse {
  const days = trend(30).days.slice().reverse().slice(1); // completed days only
  const reports = days.map((d, i) => ({
    report_date: d.date,
    total_transactions: d.total,
    total_volume_ngn: koboToDecimalString(BigInt(d.total) * BigInt(5_412_350)),
    match_rate_pct: d.match_rate_pct,
    cross_border_count: 0,
    suspicious_flags: i % 9 === 4 ? 1 : 0,
    open_discrepancies: d.total - d.matched,
    total_exposure_ngn: koboToDecimalString(BigInt(d.total - d.matched) * BigInt(2_150_000)),
    status: 'generated',
    generated_at: new Date(Date.parse(`${d.date}T01:00:00Z`) + DAY).toISOString(),
  }));
  const page = reports.slice(offset, offset + limit);
  return { reports: page, count: page.length };
}

export function readiness(): ReadinessBody {
  return {
    status: 'healthy',
    version: 'demo',
    checks: {
      postgres: { status: 'demo', error: 'Demo mode: no database is queried' },
      redpanda: { status: 'demo', error: 'Demo mode: no broker is queried' },
      minio: { status: 'demo', error: 'Demo mode: no object store is queried' },
    },
  };
}
