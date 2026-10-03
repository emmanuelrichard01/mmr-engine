'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Link2 } from 'lucide-react';
import { PairStatusBadge, StatusBadge } from '@/components/badges';
import { ConfidenceEvidence } from '@/components/confidence';
import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/empty-state';
import { FilterSelect } from '@/components/filter-select';
import { rowReveal } from '@/components/motion-primitives';
import { ErrorNotice, PanelError } from '@/components/notices';
import { PageHeader, Skeleton } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PspIcon } from '@/components/psp-logos';
import { Sheet } from '@/components/sheet';
import { TableRowsSkeleton } from '@/components/table-skeleton';
import { PAIR_STATUSES, PSPS, type PairListItem, type TransactionSummary } from '@/lib/api';
import { usePair, usePairs } from '@/lib/hooks';
import { formatNgn, toKobo } from '@/lib/money';
import { countActive, param } from '@/lib/url-state';
import { useRowKeys } from '@/lib/use-row-keys';
import { useUrlState } from '@/lib/use-url-state';
import { cn, formatDateTime, formatGap, formatScore, formatShortDateTime, humanize, parseScore, pspDisplayName, shortId, strategyLabel } from '@/lib/utils';

const PAGE_SIZE = 50;
const SCHEMA = {
  status: param.enum(PAIR_STATUSES),
  psp: param.enum(PSPS),
  offset: param.int(0, { max: 10_000_000 }),
  id: param.id(),
};
const URL_OPTIONS = { resetKey: 'offset', resetOnChange: ['status', 'psp'] } as const;

const PairRow = memo(function PairRow({ p, index, open, animateIn, onOpen }: { p: PairListItem; index: number; open: boolean; animateIn: boolean; onOpen: (id: string) => void }) {
  const reduce = useReducedMotion();
  const score = parseScore(p.confidence_score);
  const delta = toKobo(p.amount_delta_ngn);
  return (
    <motion.tr {...(animateIn ? rowReveal(index, reduce) : {})} data-interactive data-active={open || undefined} onClick={() => onOpen(p.id)}>
      <td className="relative">
        <button type="button" data-row-button className="row-button inline-flex items-center gap-2" onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}>
          <PspIcon name={p.psp_a} className="h-3.5 w-3.5" />
          <ArrowRight className="h-3 w-3 text-fg-faint" strokeWidth={1.75} aria-hidden="true" />
          <PspIcon name={p.psp_b} className="h-3.5 w-3.5" />
          <span className="sr-only">
            {pspDisplayName(p.psp_a)} to {pspDisplayName(p.psp_b)}, pair
          </span>
          <span className="t-mono ml-1 text-fg" title={p.id}>
            {shortId(p.id)}
          </span>
        </button>
      </td>
      <td className="text-fg-muted">{strategyLabel(p.match_strategy)}</td>
      <td className="cell-right num">
        <span className={cn('font-medium', score !== null && score < 0.85 ? 'text-high-text' : 'text-fg')}>{formatScore(p.confidence_score)}</span>
      </td>
      <td className="cell-right num font-medium">{formatNgn(p.amount_a_ngn)}</td>
      <td className="cell-right num">{delta && delta !== BigInt(0) ? <span className="text-critical-text">{formatNgn(p.amount_delta_ngn)}</span> : <span className="text-fg-subtle">{formatNgn('0')}</span>}</td>
      <td>
        <PairStatusBadge status={p.status} />
      </td>
      <td className="num text-fg-muted" title={formatDateTime(p.created_at)}>
        {formatShortDateTime(p.created_at)}
      </td>
    </motion.tr>
  );
});

export function MatchesView() {
  const [params, setParams] = useUrlState(SCHEMA, URL_OPTIONS);
  const tableRef = useRef<HTMLDivElement>(null);
  useRowKeys(tableRef);
  const filters = useMemo(() => ({ status: params.status, psp_name: params.psp, limit: PAGE_SIZE, offset: params.offset }), [params.status, params.psp, params.offset]);
  const { data, error, isLoading, isRefreshing, refetch, updatedAt } = usePairs(filters);
  const rows = data?.pairs ?? [];
  const active = countActive(SCHEMA, params, ['status', 'psp']);

  const filterKey = JSON.stringify(filters);
  const [revealed, setRevealed] = useState<string | null>(null);
  const animateRows = !!data && revealed !== filterKey;
  useEffect(() => {
    if (!data) return;
    const id = window.setTimeout(() => setRevealed(filterKey), 500);
    return () => window.clearTimeout(id);
  }, [data, filterKey]);

  return (
    <div className="page space-y-6">
      <PageHeader title="Matches" description="Pairs formed across PSPs. Open one to compare both legs and see why they were paired." />

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <FilterSelect label="Pair status" anyLabel="Any status" value={params.status} onChange={(status) => setParams({ status })} options={PAIR_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect label="PSP" anyLabel="Either PSP" value={params.psp} onChange={(psp) => setParams({ psp })} options={PSPS.map((p) => ({ value: p, label: pspDisplayName(p) }))} />
          {active > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({ status: undefined, psp: undefined })}>
              Clear
            </button>
          )}
        </div>

        {error && data && <ErrorNotice error={error} what="pairs" onRetry={refetch} retrying={isRefreshing} staleSince={updatedAt} className="m-3" />}

        {error && !data ? (
          <PanelError error={error} what="pairs" onRetry={refetch} retrying={isRefreshing} />
        ) : !isLoading && rows.length === 0 ? (
          <EmptyState
            icon={<Link2 className="h-5 w-5" strokeWidth={1.5} />}
            title={active ? 'No pairs match these filters' : 'No matches yet'}
            description={active ? 'Try another status or PSP.' : 'Pairs appear after the matching flow runs (every five minutes) over unmatched Silver transactions.'}
          />
        ) : (
          <div ref={tableRef} className="table-wrap max-h-[calc(100dvh-260px)] min-h-[320px]">
            <table className={cn('table', isRefreshing && 'opacity-70 transition-opacity')}>
              <caption className="sr-only">Matched pairs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Pair</th>
                  <th scope="col">Strategy</th>
                  <th scope="col" className="cell-right">
                    Confidence
                  </th>
                  <th scope="col" className="cell-right">
                    Amount
                  </th>
                  <th scope="col" className="cell-right">
                    Difference
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Paired (WAT)</th>
                </tr>
              </thead>
              {isLoading ? (
                <TableRowsSkeleton columns={7} rows={12} />
              ) : (
                <tbody>
                  {rows.map((p, i) => (
                    <PairRow key={p.id} p={p} index={i} open={params.id === p.id} animateIn={animateRows} onOpen={(id) => setParams({ id }, 'push')} />
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}

        {data && (rows.length > 0 || params.offset > 0) && (
          <div className="border-t border-line">
            <Pagination offset={params.offset} pageSize={PAGE_SIZE} shown={rows.length} onChange={(offset) => setParams({ offset })} busy={isRefreshing} noun="pairs" />
          </div>
        )}
      </div>

      <PairInspector id={params.id ?? null} onClose={() => setParams({ id: undefined })} />
    </div>
  );
}

// ── Inspector ────────────────────────────────────────────────────────────────

function Leg({ label, t }: { label: string; t: TransactionSummary }) {
  return (
    <div className="min-w-0 rounded-[10px] bg-inset p-4">
      <p className="t-caption flex items-center justify-between gap-2">
        <span>{label}</span>
        <span>{humanize(t.transaction_type)}</span>
      </p>
      <p className="mt-2 flex items-center gap-2 text-[13.5px] font-medium text-fg">
        <PspIcon name={t.psp_name} className="h-4 w-4 shrink-0" />
        {pspDisplayName(t.psp_name)}
      </p>
      <p className="t-metric mt-3 text-[22px]">{formatNgn(t.amount_ngn)}</p>
      <Link href={`/transactions?id=${t.id}`} className="t-link t-mono mt-2 block truncate text-[12.5px]">
        {t.psp_transaction_ref}
      </Link>
      <dl className="mt-3 space-y-1 text-[12.5px]">
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Initiated</dt>
          <dd className="num text-right text-fg-muted">{formatShortDateTime(t.initiated_at)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Beneficiary</dt>
          <dd className="truncate text-right text-fg-muted">{t.beneficiary_name_masked ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Bank</dt>
          <dd className="truncate text-right text-fg-muted">{t.beneficiary_bank_name ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

function PairInspector({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, isLoading, refetch, isRefreshing } = usePair(id);
  const p = data?.pair;
  const delta = toKobo(p?.amount_delta_ngn);
  const gap = parseScore((p?.match_evidence?.time_delta_seconds as number | string | null | undefined) ?? null);

  return (
    <Sheet
      open={id !== null}
      onClose={onClose}
      width="sm:max-w-[720px]"
      title={p ? `Pair ${shortId(p.id)}` : isLoading ? 'Loading pair' : 'Pair'}
      subtitle={p ? `${strategyLabel(p.match_strategy)} match, paired ${formatDateTime(p.created_at)}` : undefined}
      headerExtra={
        p ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <PairStatusBadge status={p.status} />
            <span className="badge badge-accent num">{formatScore(p.confidence_score)} confidence</span>
            {p.is_within_fx_threshold === false && <span className="badge badge-high">Outside FX threshold</span>}
            <CopyButton value={p.id} label="pair ID" />
          </div>
        ) : undefined
      }
    >
      {error ? (
        <PanelError error={error} what={error.status === 404 ? 'this pair (it no longer exists)' : 'the pair'} onRetry={error.status === 404 ? undefined : refetch} retrying={isRefreshing} />
      ) : !data || !p ? (
        <div className="space-y-6 px-6 py-6" aria-busy="true">
          <span role="status" className="sr-only">
            Loading pair
          </span>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
          <Skeleton className="h-36 w-full" />
        </div>
      ) : (
        <div className="space-y-8 px-6 py-6">
          <section aria-label="Legs">
            <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <Leg label="Leg A" t={data.a} />
              <div className="flex items-center justify-center sm:flex-col sm:gap-1.5" aria-label="Between the legs">
                <span className={cn('badge num', delta && delta !== BigInt(0) ? 'badge-critical' : 'badge-positive')}>
                  {delta && delta !== BigInt(0) ? `Δ ${formatNgn(p.amount_delta_ngn)}` : 'Same amount'}
                </span>
                {gap !== null && <span className="t-caption num ml-2 sm:ml-0">{formatGap(gap)} apart</span>}
              </div>
              <Leg label="Leg B" t={data.b} />
            </div>
          </section>

          <section aria-labelledby="why-h">
            <h3 id="why-h" className="mb-3.5 text-[13px] font-semibold text-fg">
              Why these were paired
            </h3>
            <ConfidenceEvidence strategy={p.match_strategy} score={p.confidence_score} evidence={p.match_evidence} />
          </section>

          <section aria-labelledby="pair-disc-h">
            <h3 id="pair-disc-h" className="mb-2 text-[13px] font-semibold text-fg">
              Discrepancies on this pair
            </h3>
            {data.discrepancies.length === 0 ? (
              <p className="t-body text-[13px]">None. The two legs reconcile.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.discrepancies.map((d) => (
                  <li key={d.id}>
                    <Link href={`/inbox?status=all&id=${d.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:underline">
                      <span className="flex items-center gap-2 text-[13px] text-fg">
                        {humanize(d.discrepancy_type)}
                        <StatusBadge status={d.status} className="h-[18px] px-1.5 text-[11.5px]" />
                      </span>
                      <span className="num text-[13px] text-fg-muted">{formatNgn(d.estimated_exposure_ngn)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
