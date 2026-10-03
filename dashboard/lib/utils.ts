import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

/** Percentages may be null (no transactions); they then read "—". */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('en-NG');
}

/** Signed difference in percentage points, e.g. "+0.4 pp". */
export function formatPointsDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '0.0 pp';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} pp`;
}

/** Signed integer difference, e.g. "+120". */
export function formatCountDelta(delta: number): string {
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('en-NG')}`;
}

/** Confidence scores arrive as strings ("0.8732") or numbers; null when absent or unparseable. */
export function parseScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 0.8732 → "87.3%". */
export function formatScore(value: string | number | null | undefined): string {
  const n = parseScore(value);
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`;
}

/** Durations: "0.8s", "42s", "3m 05s", "2h 14m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Seconds between two legs: "41s", "12m", "3h 20m", "2d 4h". */
export function formatGap(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.abs(Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

// ─── Dates (all API timestamps are ISO-8601 UTC; display in Africa/Lagos) ─────

export const DISPLAY_TZ = 'Africa/Lagos';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Numeric parts only, so output does not depend on the runtime's month names.
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function lagosParts(input: string | number | null | undefined): Record<string, string> | null {
  if (input === null || input === undefined || input === '') return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return Object.fromEntries(partsFmt.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "2 Oct 2026, 14:05 WAT" */
export function formatDateTime(iso: string | number | null | undefined): string {
  const p = lagosParts(iso);
  if (!p) return '—';
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} WAT`;
}

/** "2 Oct, 14:05" (WAT, compact for tables). */
export function formatShortDateTime(iso: string | number | null | undefined): string {
  const p = lagosParts(iso);
  if (!p) return '—';
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}, ${p.hour}:${p.minute}`;
}

/** "14:05:09 WAT" */
export function formatTime(input: string | number | null | undefined): string {
  const p = lagosParts(input);
  if (!p) return '—';
  return `${p.hour}:${p.minute}:${p.second} WAT`;
}

/** The Lagos calendar date ("YYYY-MM-DD") of an instant. */
export function lagosDate(input: string | number | Date): string {
  const p = lagosParts(input instanceof Date ? input.getTime() : input);
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}

/**
 * Format a calendar date ("YYYY-MM-DD") without any timezone conversion:
 * report dates are business days, not instants.
 */
export function formatCalendarDate(ymd: string | null | undefined, withYear = true): string {
  if (!ymd) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const [, y, mo, d] = m;
  const label = `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}`;
  return withYear ? `${label} ${y}` : label;
}

/** Compact age, e.g. "45m", "6h", "3d". `now` is passed in to keep renders pure. */
export function formatAge(iso: string | null | undefined, now: number | null): string {
  if (!iso || now === null) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Minutes since an instant, or null when unknown. */
export function minutesSince(iso: string | null | undefined, now: number | null): number | null {
  if (!iso || now === null) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, (now - then) / 60_000);
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/[_-]/g, ' ').replace(/\bfx\b/gi, 'FX').replace(/\bpsp\b/gi, 'PSP');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PSP_NAMES: Record<string, string> = {
  paystack: 'Paystack',
  flutterwave: 'Flutterwave',
};

export function pspDisplayName(name: string | null | undefined): string {
  if (!name) return '—';
  return PSP_NAMES[name.toLowerCase()] ?? humanize(name);
}

const FLOW_LABELS: Record<string, string> = {
  'silver-to-gold-matching-flow': 'Matching',
  'fx-rate-capture-flow': 'FX capture',
  'gap-detection-flow': 'Gap detection',
  'daily-return-flow': 'Daily return',
  'bronze-to-silver-consumer': 'Consumer',
  'polling-backfill-flow': 'Polling backfill',
  'webhook-ingestion-flow': 'Webhook ingestion',
};

/** The flows the scheduler and consumer record, in the order the Activity page lists them. */
export const KNOWN_FLOWS = [
  'silver-to-gold-matching-flow',
  'fx-rate-capture-flow',
  'gap-detection-flow',
  'daily-return-flow',
  'bronze-to-silver-consumer',
] as const;

export function flowLabel(flowName: string | null | undefined): string {
  if (!flowName) return '—';
  return FLOW_LABELS[flowName] ?? humanize(flowName.replace(/-flow$/, ''));
}

const STRATEGY_LABELS: Record<string, string> = {
  exact_primary: 'Exact',
  probabilistic_secondary: 'Probabilistic',
  manual: 'Manual',
};

export function strategyLabel(strategy: string | null | undefined): string {
  if (!strategy) return '—';
  return STRATEGY_LABELS[strategy] ?? humanize(strategy);
}

/** Shorten a UUID for display: "3f2a…9c1d". The full value stays in titles and copy actions. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
