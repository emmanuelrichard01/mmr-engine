import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-NG');
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

// ─── Dates (all API timestamps are ISO-8601 UTC; display in Africa/Lagos) ─────

const DISPLAY_TZ = 'Africa/Lagos';

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
export function formatDateTime(iso: string | null | undefined): string {
  const p = lagosParts(iso);
  if (!p) return '—';
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} WAT`;
}

/** "14:05:09 WAT" */
export function formatTime(input: string | number | null | undefined): string {
  const p = lagosParts(input);
  if (!p) return '—';
  return `${p.hour}:${p.minute}:${p.second} WAT`;
}

/**
 * Format a calendar date ("YYYY-MM-DD") without any timezone conversion —
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

// ─── Labels ──────────────────────────────────────────────────────────────────

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ').replace(/\bfx\b/gi, 'FX');
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
