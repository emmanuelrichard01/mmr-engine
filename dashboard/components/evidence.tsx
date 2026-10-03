'use client';

import type { ReactNode } from 'react';
import { formatKobo, formatNgn, koboRatio, maxKobo, toKobo } from '@/lib/money';
import { cn, formatDateTime, formatGap, humanize } from '@/lib/utils';

// Evidence is the engine's reasoning for raising a discrepancy. Known shapes
// (see src/engine/discrepancy.py) get a purpose-built view; anything else is
// shown as labelled fields. The raw JSON is always one click away.

type Evidence = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function Fact({ label, children, tone }: { label: string; children: ReactNode; tone?: 'critical' | 'muted' }) {
  return (
    <div>
      <dt className="t-caption">{label}</dt>
      <dd className={cn('num mt-1 text-[14px] font-medium text-fg', tone === 'critical' && 'text-critical-text', tone === 'muted' && 'text-fg-muted')}>
        {children}
      </dd>
    </div>
  );
}

/** Two amounts side by side, with bars to the same scale so the gap is visible. */
function AmountComparison({ ev, fx }: { ev: Evidence; fx: boolean }) {
  const a = toKobo(str(ev.amount_a_ngn));
  const b = toKobo(str(ev.amount_b_ngn));
  const delta = toKobo(str(ev.delta_ngn)) ?? (a !== null && b !== null ? (a > b ? a - b : b - a) : null);
  const pct = num(ev.delta_pct);
  const fxVariance = num(ev.fx_variance);
  const max = maxKobo([a ?? BigInt(0), b ?? BigInt(0)]);
  const legs: [string, bigint | null][] = [
    ['Leg A', a],
    ['Leg B', b],
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {legs.map(([label, kobo]) => (
          <div key={label} className="grid grid-cols-[52px_1fr_auto] items-center gap-3">
            <span className="t-caption">{label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-inset" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-fg-faint"
                style={{ width: `${kobo === null ? 0 : Math.max(2, koboRatio(kobo, max) * 100)}%` }}
              />
            </span>
            <span className="num text-[13.5px] font-medium text-fg">{kobo === null ? '—' : formatKobo(kobo)}</span>
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact label="Difference" tone="critical">
          {delta === null ? '—' : formatKobo(delta)}
        </Fact>
        <Fact label="Difference, share of leg A">{pct === null ? '—' : `${(pct * 100).toFixed(2)}%`}</Fact>
        {fx && <Fact label="FX rate movement">{fxVariance === null ? '—' : `${(fxVariance * 100).toFixed(3)}%`}</Fact>}
      </dl>
    </div>
  );
}

/** Expected vs actual settlement, and by how much it overran. */
function SettlementTimeline({ expected, actual, actualLabel, overrunHours }: { expected: string | null; actual: string | null; actualLabel: string; overrunHours: number | null }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Fact label="Expected by">{expected ? formatDateTime(expected) : '—'}</Fact>
      <Fact label={actualLabel} tone={actual ? undefined : 'muted'}>
        {actual ? formatDateTime(actual) : 'Not yet'}
      </Fact>
      <Fact label={actual ? 'Late by' : 'Overdue by'} tone="critical">
        {overrunHours === null ? '—' : formatGap(overrunHours * 3600)}
      </Fact>
    </dl>
  );
}

function formatValue(key: string, value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className="text-fg-subtle">None</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('_ngn')) return formatNgn(str(value));
  if (key.endsWith('_pct') && num(value) !== null) return `${((num(value) as number) * 100).toFixed(2)}%`;
  if (key.endsWith('_hours') && num(value) !== null) return formatGap((num(value) as number) * 3600);
  if (key.endsWith('_seconds') && num(value) !== null) return formatGap(num(value) as number);
  if (typeof value === 'string' && ISO_RE.test(value)) return formatDateTime(value);
  if (typeof value === 'object') return <code className="t-mono break-all">{JSON.stringify(value)}</code>;
  return String(value);
}

/** "overdue_hours" → "Overdue", "amount_per_occurrence_ngn" → "Amount per occurrence": the unit shows in the value. */
function fieldLabel(key: string): string {
  return humanize(key.replace(/_(ngn|hours|seconds|pct)$/, ''));
}

export function EvidenceFields({ evidence, omit = [] }: { evidence: Evidence; omit?: string[] }) {
  const entries = Object.entries(evidence).filter(([k]) => !omit.includes(k));
  if (!entries.length) return null;
  return (
    <dl className="dl-rows">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{fieldLabel(k)}</dt>
          <dd className="num">{formatValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Evidence({ type, evidence }: { type: string; evidence: Evidence | null }) {
  if (!evidence || Object.keys(evidence).length === 0) {
    return <p className="t-body text-[13px]">The engine recorded no evidence for this discrepancy.</p>;
  }

  let view: ReactNode = null;
  let shown: string[] = [];

  if ((type === 'amount_mismatch' || type === 'fx_variance') && ('amount_a_ngn' in evidence || 'delta_ngn' in evidence)) {
    view = <AmountComparison ev={evidence} fx={type === 'fx_variance' || evidence.fx_variance != null} />;
    shown = ['amount_a_ngn', 'amount_b_ngn', 'delta_ngn', 'delta_pct', 'fx_variance', 'classification'];
  } else if (type === 'missing_settlement' && 'expected_settlement_at' in evidence) {
    view = <SettlementTimeline expected={str(evidence.expected_settlement_at)} actual={null} actualLabel="Settled" overrunHours={num(evidence.overdue_hours)} />;
    shown = ['expected_settlement_at', 'overdue_hours', 'amount_ngn'];
  } else if (type === 'late_settlement' && ('expected_at' in evidence || 'settled_at' in evidence)) {
    view = <SettlementTimeline expected={str(evidence.expected_at)} actual={str(evidence.settled_at)} actualLabel="Settled" overrunHours={num(evidence.late_hours)} />;
    shown = ['expected_at', 'settled_at', 'late_hours', 'amount_ngn'];
  } else if (type === 'duplicate_credit' && 'occurrence_count' in evidence) {
    const count = num(evidence.occurrence_count);
    view = (
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact label="Times delivered">{count === null ? '—' : `${count}×`}</Fact>
        <Fact label="Each">{formatNgn(str(evidence.amount_per_occurrence_ngn))}</Fact>
        <Fact label="Duplicated exposure" tone="critical">
          {formatNgn(str(evidence.total_duplicate_exposure_ngn))}
        </Fact>
      </dl>
    );
    shown = ['occurrence_count', 'amount_per_occurrence_ngn', 'total_duplicate_exposure_ngn'];
  } else if (typeof evidence.reason === 'string') {
    view = <p className="text-[13.5px] leading-relaxed text-fg">{evidence.reason}</p>;
    shown = ['reason', 'amount_ngn'];
  }

  const rest = Object.fromEntries(Object.entries(evidence).filter(([k]) => !shown.includes(k)));

  return (
    <div className="space-y-4">
      {view}
      {Object.keys(rest).length > 0 && <EvidenceFields evidence={rest} />}
      <details className="group">
        <summary className="t-caption cursor-pointer select-none rounded-[4px] hover:text-fg">Raw evidence</summary>
        <pre className="code-block mt-2">{JSON.stringify(evidence, null, 2)}</pre>
      </details>
    </div>
  );
}
