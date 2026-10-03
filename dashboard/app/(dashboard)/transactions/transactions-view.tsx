'use client';

import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, RotateCcw, Search, X } from 'lucide-react';
import { MatchBadge, SettlementBadge, StatusBadge } from '@/components/badges';
import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/empty-state';
import { FilterSelect } from '@/components/filter-select';
import { LineageTimeline } from '@/components/lineage';
import { rowReveal } from '@/components/motion-primitives';
import { ErrorNotice, PanelError } from '@/components/notices';
import { PageHeader, Skeleton } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PspIcon, PspName } from '@/components/psp-logos';
import { Sheet } from '@/components/sheet';
import { TableRowsSkeleton } from '@/components/table-skeleton';
import { TabList, TabPanel } from '@/components/tabs';
import {
  PSPS,
  SETTLEMENT_STATUSES,
  TRANSACTION_TYPES,
  type TransactionDetailResponse,
  type TransactionSummary,
} from '@/lib/api';
import { useTransaction, useTransactions } from '@/lib/hooks';
import { formatNgn } from '@/lib/money';
import { countActive, param } from '@/lib/url-state';
import { useRowKeys } from '@/lib/use-row-keys';
import { useUrlState } from '@/lib/use-url-state';
import { cn, formatDateTime, formatScore, formatShortDateTime, humanize, pspDisplayName, shortId, strategyLabel } from '@/lib/utils';

const PAGE_SIZES = [50, 100, 200] as const;

const SCHEMA = {
  q: param.string(64),
  psp: param.enum(PSPS),
  type: param.enum(TRANSACTION_TYPES),
  match: param.enum(['matched', 'unmatched'] as const),
  settlement: param.enum(SETTLEMENT_STATUSES),
  from: param.date(),
  to: param.date(),
  size: param.int(50, { allowed: PAGE_SIZES }),
  offset: param.int(0, { max: 10_000_000 }),
  id: param.id(),
};
const FILTER_KEYS = ['q', 'psp', 'type', 'match', 'settlement', 'from', 'to'] as const;
const URL_OPTIONS = { resetKey: 'offset', resetOnChange: [...FILTER_KEYS, 'size'] } as const;

const TYPE_ICON = { credit: ArrowDownLeft, debit: ArrowUpRight, reversal: RotateCcw } as const;

// ── Row ──────────────────────────────────────────────────────────────────────

const TxRow = memo(function TxRow({
  t,
  index,
  open,
  animateIn,
  onOpen,
}: {
  t: TransactionSummary;
  index: number;
  open: boolean;
  animateIn: boolean;
  onOpen: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const Icon = TYPE_ICON[t.transaction_type as keyof typeof TYPE_ICON] ?? ArrowLeftRight;
  return (
    <motion.tr {...(animateIn ? rowReveal(index, reduce) : {})} data-interactive data-active={open || undefined} onClick={() => onOpen(t.id)}>
      <td className="relative">
        <button type="button" data-row-button className="row-button inline-flex items-center gap-2.5" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-inset text-fg-muted" aria-hidden="true">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span className="t-mono text-fg">{t.psp_transaction_ref}</span>
        </button>
      </td>
      <td>
        <PspName name={t.psp_name} className="text-fg-muted" />
      </td>
      <td className="text-fg-muted">{humanize(t.transaction_type)}</td>
      <td className="cell-right">
        <span className="num font-medium">{formatNgn(t.amount_ngn)}</span>
        {t.currency_raw !== 'NGN' && <span className="t-caption num ml-1.5">{t.currency_raw}</span>}
      </td>
      <td>
        <SettlementBadge status={t.settlement_status} />
      </td>
      <td>
        <MatchBadge status={t.match_status} />
      </td>
      <td className="cell-right num">
        {t.open_discrepancies > 0 ? <span className="font-medium text-critical-text">{t.open_discrepancies}</span> : <span className="text-fg-subtle">0</span>}
      </td>
      <td className="num text-fg-muted" title={formatDateTime(t.initiated_at)}>
        {formatShortDateTime(t.initiated_at)}
      </td>
    </motion.tr>
  );
});

// ── View ─────────────────────────────────────────────────────────────────────

export function TransactionsView() {
  const [params, setParams] = useUrlState(SCHEMA, URL_OPTIONS);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useRowKeys(tableRef, searchRef);

  // The search box updates the URL once typing settles.
  const [draft, setDraft] = useState(params.q ?? '');
  const searchTimer = useRef<number | undefined>(undefined);
  const onSearch = (value: string) => {
    setDraft(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setParams({ q: value.trim() || undefined }), 300);
  };
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);
  // When the URL's query changes from outside (back button, a shared link), follow it.
  const [lastQ, setLastQ] = useState(params.q);
  if (lastQ !== params.q) {
    setLastQ(params.q);
    if ((params.q ?? '') !== draft.trim()) setDraft(params.q ?? '');
  }

  const filters = useMemo(
    () => ({
      q: params.q,
      psp_name: params.psp,
      transaction_type: params.type,
      match_status: params.match,
      settlement_status: params.settlement,
      date_from: params.from,
      date_to: params.to,
      limit: params.size,
      offset: params.offset,
    }),
    [params.q, params.psp, params.type, params.match, params.settlement, params.from, params.to, params.size, params.offset],
  );
  const { data, error, isLoading, isRefreshing, refetch, updatedAt } = useTransactions(filters);
  const rows = data?.transactions ?? [];
  const active = countActive(SCHEMA, params, FILTER_KEYS);
  const rangeInvalid = !!params.from && !!params.to && params.from > params.to;

  const filterKey = JSON.stringify(filters);
  const [revealed, setRevealed] = useState<string | null>(null);
  const animateRows = !!data && revealed !== filterKey && rows.length <= 100;
  useEffect(() => {
    if (!data) return;
    const id = window.setTimeout(() => setRevealed(filterKey), 500);
    return () => window.clearTimeout(id);
  }, [data, filterKey]);

  const fromId = useId();
  const toId = useId();
  const searchId = useId();
  const sizeId = useId();

  const open = (id: string) => setParams({ id }, 'push');

  return (
    <div className="page space-y-6">
      <PageHeader
        title="Transactions"
        description="Canonical transactions in Silver. Open one to trace it from the broker to its match."
      />

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
            <label htmlFor={searchId} className="sr-only">
              Search by PSP reference or transaction ID
            </label>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={draft}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Reference prefix or exact ID"
              className="input input-sm pl-8 pr-8"
              spellCheck={false}
              autoComplete="off"
            />
            <kbd className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden="true">
              /
            </kbd>
          </div>
          <FilterSelect label="PSP" anyLabel="Any PSP" value={params.psp} onChange={(psp) => setParams({ psp })} options={PSPS.map((p) => ({ value: p, label: pspDisplayName(p) }))} />
          <FilterSelect label="Type" anyLabel="Any type" value={params.type} onChange={(type) => setParams({ type })} options={TRANSACTION_TYPES.map((v) => ({ value: v, label: humanize(v) }))} />
          <FilterSelect
            label="Match status"
            anyLabel="Matched or not"
            value={params.match}
            onChange={(match) => setParams({ match })}
            options={[
              { value: 'matched', label: 'Matched' },
              { value: 'unmatched', label: 'Unmatched' },
            ]}
          />
          <FilterSelect label="Settlement" anyLabel="Any settlement" value={params.settlement} onChange={(settlement) => setParams({ settlement })} options={SETTLEMENT_STATUSES.map((v) => ({ value: v, label: humanize(v) }))} />
          <span className="inline-flex items-center gap-1.5">
            <label htmlFor={fromId} className="sr-only">
              From date
            </label>
            <input id={fromId} type="date" className="input input-sm w-[140px]" value={params.from ?? ''} max={params.to} onChange={(e) => setParams({ from: e.target.value || undefined })} aria-invalid={rangeInvalid} />
            <span className="t-caption" aria-hidden="true">
              to
            </span>
            <label htmlFor={toId} className="sr-only">
              To date
            </label>
            <input id={toId} type="date" className="input input-sm w-[140px]" value={params.to ?? ''} min={params.from} onChange={(e) => setParams({ to: e.target.value || undefined })} aria-invalid={rangeInvalid} />
          </span>
          {active > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                window.clearTimeout(searchTimer.current);
                setDraft('');
                setParams({ q: undefined, psp: undefined, type: undefined, match: undefined, settlement: undefined, from: undefined, to: undefined });
              }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              Clear {active}
            </button>
          )}
        </div>

        {rangeInvalid && <p className="notice notice-warn m-3">The start date is after the end date, so nothing can match.</p>}
        {error && data && <ErrorNotice error={error} what="transactions" onRetry={refetch} retrying={isRefreshing} staleSince={updatedAt} className="m-3" />}

        {error && !data ? (
          <PanelError error={error} what="transactions" onRetry={refetch} retrying={isRefreshing} />
        ) : !isLoading && rows.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="h-5 w-5" strokeWidth={1.5} />}
            title={active ? 'No transactions match' : 'No transactions yet'}
            description={
              active
                ? params.q
                  ? `Nothing starts with “${params.q}”. References match from the start; IDs must be exact.`
                  : 'Widen the date range or clear a filter.'
                : 'Transactions appear here once PSP webhooks have been ingested and normalised.'
            }
          />
        ) : (
          <div ref={tableRef} className="table-wrap max-h-[calc(100dvh-280px)] min-h-[320px]">
            <table className={cn('table', isRefreshing && 'opacity-70 transition-opacity')}>
              <caption className="sr-only">Transactions, newest first. Select a reference to open its lineage.</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">PSP</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="cell-right">
                    Amount
                  </th>
                  <th scope="col">Settlement</th>
                  <th scope="col">Match</th>
                  <th scope="col" className="cell-right">
                    Open
                  </th>
                  <th scope="col">Initiated (WAT)</th>
                </tr>
              </thead>
              {isLoading ? (
                <TableRowsSkeleton columns={8} rows={12} />
              ) : (
                <tbody>
                  {rows.map((t, i) => (
                    <TxRow key={t.id} t={t} index={i} open={params.id === t.id} animateIn={animateRows} onOpen={open} />
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}

        {data && (
          <div className="flex items-center justify-between border-t border-line pl-4">
            <span className="inline-flex items-center gap-2">
              <label htmlFor={sizeId} className="t-caption">
                Rows
              </label>
              <select id={sizeId} className="select select-sm w-auto" value={params.size} onChange={(e) => setParams({ size: Number(e.target.value) })}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
            <Pagination offset={params.offset} pageSize={params.size} shown={rows.length} total={data.total} onChange={(offset) => setParams({ offset })} busy={isRefreshing} noun="transactions" />
          </div>
        )}
      </div>

      <TransactionSheet id={params.id ?? null} onClose={() => setParams({ id: undefined })} />
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────────

function TransactionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, isLoading, refetch, isRefreshing } = useTransaction(id);
  const [tab, setTab] = useState<'overview' | 'lineage'>('overview');
  const tabsId = useId();
  const t = data?.transaction;

  return (
    <Sheet
      open={id !== null}
      onClose={() => {
        setTab('overview');
        onClose();
      }}
      title={t ? <span className="t-mono text-[16px]">{t.psp_transaction_ref}</span> : isLoading ? 'Loading transaction' : 'Transaction'}
      subtitle={t ? <>{pspDisplayName(t.psp_name)} · {humanize(t.transaction_type)} · <span className="t-mono">{t.psp_event_type}</span></> : undefined}
      headerExtra={
        t ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <SettlementBadge status={t.settlement_status} />
            <MatchBadge status={t.match_status} />
            {t.open_discrepancies > 0 && <span className="badge badge-critical">{t.open_discrepancies} open</span>}
          </div>
        ) : undefined
      }
    >
      {error ? (
        <PanelError error={error} what={error.status === 404 ? 'this transaction (it is not in Silver)' : 'the transaction'} onRetry={error.status === 404 ? undefined : refetch} retrying={isRefreshing} />
      ) : !data ? (
        <div className="space-y-6 px-6 py-6" aria-busy="true">
          <span role="status" className="sr-only">
            Loading transaction
          </span>
          <Skeleton className="h-9 w-48" />
          <div className="space-y-3">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-6 pb-8">
          <div className="pb-1 pt-5">
            <p className="t-caption">Amount</p>
            <p className="t-metric mt-1.5 text-[30px]">{formatNgn(data.transaction.amount_ngn)}</p>
            {data.transaction.currency_raw !== 'NGN' && (
              <p className="t-caption num mt-1">
                {data.transaction.amount_raw} {data.transaction.currency_raw} at {data.transaction.fx_rate_applied ?? '—'} per unit
              </p>
            )}
          </div>
          <TabList
            label="Transaction sections"
            idBase={tabsId}
            className="mt-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'lineage', label: 'Lineage' },
            ]}
          />
          <TabPanel idBase={tabsId} value={tab} className="pt-5">
            {tab === 'overview' ? <TransactionOverview detail={data} /> : <LineageTimeline detail={data} />}
          </TabPanel>
        </div>
      )}
    </Sheet>
  );
}

function TransactionOverview({ detail }: { detail: TransactionDetailResponse }) {
  const { transaction: t, pair, discrepancies } = detail;
  return (
    <div className="space-y-7">
      {pair ? (
        <section aria-labelledby="counterpart-h">
          <div className="mb-3 flex items-center justify-between">
            <h3 id="counterpart-h" className="text-[13px] font-semibold text-fg">
              Matched with
            </h3>
            <Link href={`/matches?id=${pair.id}`} className="t-link text-[12.5px]">
              Inspect pair
            </Link>
          </div>
          <Link href={`/transactions?id=${pair.counterpart.id}`} className="block rounded-[10px] bg-inset px-4 py-3.5 transition-colors hover:bg-panel-hover">
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <PspIcon name={pair.counterpart.psp_name} className="h-4 w-4 shrink-0" />
                <span className="t-mono truncate text-fg">{pair.counterpart.psp_transaction_ref}</span>
              </span>
              <span className="num shrink-0 font-medium text-fg">{formatNgn(pair.counterpart.amount_ngn)}</span>
            </span>
            <span className="t-caption mt-1 block">
              {humanize(pair.counterpart.transaction_type)} · {formatDateTime(pair.counterpart.initiated_at)} · {strategyLabel(pair.match_strategy)}, {formatScore(pair.confidence_score)} confidence
            </span>
          </Link>
        </section>
      ) : (
        <p className="rounded-[10px] bg-inset px-4 py-3 text-[13px] text-fg-muted">Not matched. The engine has not paired this transaction with a counterpart.</p>
      )}

      {discrepancies.length > 0 && (
        <section aria-labelledby="disc-h">
          <h3 id="disc-h" className="mb-2 text-[13px] font-semibold text-fg">
            Discrepancies
          </h3>
          <ul className="divide-y divide-line">
            {discrepancies.map((d) => (
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
        </section>
      )}

      <section aria-labelledby="facts-h">
        <h3 id="facts-h" className="mb-1 text-[13px] font-semibold text-fg">
          Details
        </h3>
        <dl className="dl-rows">
          <div>
            <dt>Initiated</dt>
            <dd className="num">{formatDateTime(t.initiated_at)}</dd>
          </div>
          <div>
            <dt>Settled</dt>
            <dd className="num">{t.settled_at ? formatDateTime(t.settled_at) : 'Not yet'}</dd>
          </div>
          <div>
            <dt>Expected settlement</dt>
            <dd className="num">{formatDateTime(t.expected_settlement_at)}</dd>
          </div>
          <div>
            <dt>Beneficiary</dt>
            <dd>{t.beneficiary_name_masked ?? '—'}</dd>
          </div>
          <div>
            <dt>Bank and account</dt>
            <dd>
              {t.beneficiary_bank_name ?? '—'}
              {t.beneficiary_account_masked ? <span className="t-mono ml-2 text-fg-muted">{t.beneficiary_account_masked}</span> : null}
            </dd>
          </div>
          <div>
            <dt>Narration</dt>
            <dd>{t.narration ?? '—'}</dd>
          </div>
          <div>
            <dt>Transaction ID</dt>
            <dd className="flex items-center gap-1.5">
              <span className="t-mono" title={t.id}>
                {shortId(t.id)}
              </span>
              <CopyButton value={t.id} label="transaction ID" />
            </dd>
          </div>
          <div>
            <dt>PSP</dt>
            <dd>
              <PspName name={t.psp_name} />
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
