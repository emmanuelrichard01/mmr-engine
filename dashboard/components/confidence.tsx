'use client';

import { motion, useReducedMotion } from 'motion/react';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { formatGap, parseScore } from '@/lib/utils';

// Tier 2 score = 0.40·amount + 0.25·time + 0.25·name + 0.10·bank (docs/ARCHITECTURE.md).
const SIGNALS = [
  { key: 'amount_score', label: 'Amount', weight: 0.4, explain: 'How close the two amounts are, within tolerance' },
  { key: 'time_score', label: 'Time', weight: 0.25, explain: 'How close in time, within the secondary window' },
  { key: 'name_score', label: 'Name', weight: 0.25, explain: 'Beneficiary name similarity (tokenised)' },
  { key: 'bank_score', label: 'Bank', weight: 0.1, explain: 'Same beneficiary bank' },
] as const;

function Bar({ value, delay }: { value: number; delay: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative block h-2 overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <motion.span
        className="absolute inset-y-0 left-0 rounded-full bg-accent"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, transformOrigin: 'left center' }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: DURATION.reveal, ease: EASE_OUT, delay }}
      />
    </span>
  );
}

/** Per-signal evidence for a probabilistic match, or the exact-match facts. */
export function ConfidenceEvidence({ strategy, score, evidence }: { strategy: string; score: string | number | null; evidence: Record<string, unknown> | null }) {
  const ev = evidence ?? {};
  const total = parseScore(score);
  const timeDelta = parseScore(ev.time_delta_seconds as number | string | null);

  if (strategy === 'exact_primary') {
    const candidates = parseScore(ev.exact_candidates as number | string | null);
    return (
      <div className="space-y-3">
        <p className="text-[13.5px] leading-relaxed text-fg">
          Tier 1, exact: a different PSP, a complementary type, the identical amount, inside the primary time window.
        </p>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="t-caption">Time between legs</dt>
            <dd className="num mt-1 text-[14px] font-medium text-fg">{formatGap(timeDelta)}</dd>
          </div>
          <div>
            <dt className="t-caption">Exact candidates</dt>
            <dd className="num mt-1 text-[14px] font-medium text-fg">{candidates ?? '—'}</dd>
          </div>
        </dl>
      </div>
    );
  }

  const present = SIGNALS.filter((s) => parseScore(ev[s.key] as number | string | null) !== null);
  if (present.length === 0) {
    return <p className="t-body text-[13px]">No per-signal evidence was recorded for this pair.</p>;
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Confidence by signal. Score is the signal on its own; contribution is the score times its weight.</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="pb-2 font-medium text-fg-subtle">
              Signal
            </th>
            <th scope="col" className="w-[44%] pb-2 font-medium text-fg-subtle">
              <span className="sr-only">Bar</span>
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-fg-subtle">
              Score
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-fg-subtle">
              Weight
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-fg-subtle">
              Adds
            </th>
          </tr>
        </thead>
        <tbody>
          {SIGNALS.map((s, i) => {
            const v = parseScore(ev[s.key] as number | string | null);
            return (
              <tr key={s.key} className="border-t border-line">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium text-fg" title={s.explain}>
                  {s.label}
                </th>
                <td className="py-2.5 pr-3">{v === null ? <span className="t-caption">Not recorded</span> : <Bar value={v} delay={i * 0.06} />}</td>
                <td className="num py-2.5 text-right text-fg">{v === null ? '—' : `${(v * 100).toFixed(0)}%`}</td>
                <td className="num py-2.5 text-right text-fg-subtle">{(s.weight * 100).toFixed(0)}%</td>
                <td className="num py-2.5 text-right font-medium text-fg">{v === null ? '—' : (v * s.weight).toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
        {total !== null && (
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" colSpan={4} className="pt-2.5 text-left font-semibold text-fg">
                Confidence (threshold 0.75)
              </th>
              <td className="num pt-2.5 text-right font-semibold text-fg">{total.toFixed(3)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      {timeDelta !== null && <p className="t-caption">Legs were {formatGap(timeDelta)} apart.</p>}
    </div>
  );
}
