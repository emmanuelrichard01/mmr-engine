'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { SeverityBadge, STATUS_LABEL, StatusBadge } from '@/components/badges';
import { EmptyState } from '@/components/empty-state';
import { ErrorNotice, Toast } from '@/components/notices';
import { PageHeader, Skeleton } from '@/components/page-header';
import { PspName } from '@/components/psp-logos';
import {
  DISCREPANCY_STATUSES,
  PSPS,
  SEVERITIES,
  type DiscrepancyStatus,
  type ResolveResponse,
  type Severity,
} from '@/lib/api';
import { useDiscrepancies, useNow } from '@/lib/hooks';
import { formatNgn } from '@/lib/money';
import { cn, formatAge, formatDateTime, humanize, pspDisplayName } from '@/lib/utils';
import { DiscrepancyPanel } from './discrepancy-panel';

const PAGE_SIZE = 50;

type StatusFilter = DiscrepancyStatus | 'all';

export function DiscrepanciesView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = useNow();

  // A deep link (?id=) searches every status so the item is found regardless of its state.
  const [status, setStatus] = useState<StatusFilter>(() => (searchParams.get('id') ? 'all' : 'open'));
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [psp, setPsp] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const raw = Number(searchParams.get('id'));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  });
  const [toast, setToast] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      status,
      severity: severity === 'all' ? undefined : severity,
      psp_name: psp === 'all' ? undefined : psp,
      limit: PAGE_SIZE,
      offset,
    }),
    [status, severity, psp, offset],
  );
  const { data, error, isLoading, isRefreshing, refetch, updatedAt } = useDiscrepancies(filters);

  const rows = useMemo(() => data?.discrepancies ?? [], [data]);
  const statusLabel = status === 'all' ? 'All statuses' : STATUS_LABEL[status];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (d) =>
        (d.psp_transaction_ref ?? '').toLowerCase().includes(q) ||
        String(d.id).includes(q) ||
        String(d.transaction_id).includes(q),
    );
  }, [rows, search]);

  const selected = selectedId === null ? null : rows.find((d) => d.id === selectedId) ?? null;
  const missingDeepLink = selectedId !== null && !isLoading && !error && !selected;

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    if (searchParams.get('id')) router.replace(pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const onResolved = useCallback(
    (result: ResolveResponse) => {
      clearSelection();
      setToast(
        `Discrepancy #${result.discrepancy_id} ${result.status === 'false_positive' ? 'marked as a false positive' : 'resolved'} by ${result.resolved_by}.`,
      );
      refetch();
    },
    [clearSelection, refetch],
  );
  const closeToast = useCallback(() => setToast(null), []);

  function changeFilter<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setOffset(0);
    };
  }

  const statusId = useId();
  const pspId = useId();
  const searchId = useId();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Discrepancies"
        description="Transactions the engine could not reconcile cleanly. Filters are applied by the API."
        actions={
          <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {/* Filters */}
      <div className="card card-compact">
        <div className="flex flex-wrap items-end gap-3">
          <div className="field">
            <label htmlFor={statusId}>Status</label>
            <select
              id={statusId}
              className="select w-[160px]"
              value={status}
              onChange={(e) => changeFilter(setStatus)(e.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              {DISCREPANCY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor={pspId}>PSP</label>
            <select
              id={pspId}
              className="select w-[150px]"
              value={psp}
              onChange={(e) => changeFilter(setPsp)(e.target.value)}
            >
              <option value="all">All PSPs</option>
              {PSPS.map((p) => (
                <option key={p} value={p}>
                  {pspDisplayName(p)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="field">
            <legend>Severity</legend>
            <div className="segmented">
              {(['all', ...SEVERITIES] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={severity === s}
                  onClick={() => changeFilter(setSeverity)(s)}
                  className="segmented-item"
                >
                  {s === 'all' ? 'All' : humanize(s)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="field min-w-[200px] flex-1">
            <label htmlFor={searchId}>Find on this page</label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-surface-500)]"
                aria-hidden="true"
              />
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="PSP reference, discrepancy or transaction ID"
                className="input pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      {missingDeepLink && (
        <div role="status" className="notice notice-info">
          <p className="flex-1">
            Discrepancy #{selectedId} isn’t in the current view ({statusLabel}, rows {offset + 1}–
            {offset + PAGE_SIZE}). It may have a different status — try another status filter.
          </p>
          <button type="button" onClick={clearSelection} className="icon-btn" aria-label="Dismiss">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {error && (
        <ErrorNotice
          error={error}
          what="discrepancies"
          onRetry={refetch}
          retrying={isRefreshing}
          staleSince={data ? updatedAt : null}
        />
      )}

      {/* Table */}
      <div className="card card-flush">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data ? (
          <EmptyState title="No data" description="The discrepancy list could not be loaded." />
        ) : visible.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? status === 'all' ? 'No discrepancies' : `No ${statusLabel.toLowerCase()} discrepancies` : 'No matches on this page'}
            description={
              rows.length === 0
                ? 'Nothing matches these filters.'
                : 'No row on this page matches your search. Clear the search or change page.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <caption className="sr-only">
                {status === 'all' ? 'All' : statusLabel} discrepancies
                {severity !== 'all' ? `, ${severity} severity` : ''}
                {psp !== 'all' ? `, ${pspDisplayName(psp)}` : ''}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Discrepancy</th>
                  <th scope="col">PSP</th>
                  <th scope="col" className="text-right">Amount</th>
                  <th scope="col" className="text-right">Exposure</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detected</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={cn('cursor-pointer', selectedId === d.id && 'is-selected')}
                  >
                    <td>
                      <button
                        type="button"
                        className="row-link text-left"
                        aria-haspopup="dialog"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(d.id);
                        }}
                      >
                        <span className="block font-medium">{humanize(d.discrepancy_type)}</span>
                        <span className="text-mono block text-[var(--color-surface-500)]">
                          #{d.id} · {d.psp_transaction_ref ?? `txn ${d.transaction_id}`}
                        </span>
                      </button>
                    </td>
                    <td>
                      <PspName name={d.psp_name} />
                    </td>
                    <td className="text-financial text-right">{formatNgn(d.amount_ngn)}</td>
                    <td className="text-financial text-right font-medium">{formatNgn(d.estimated_exposure_ngn)}</td>
                    <td>
                      <SeverityBadge severity={d.severity} />
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="whitespace-nowrap text-[var(--color-surface-600)]">
                      <span className="block">{formatDateTime(d.detected_at)}</span>
                      <span className="text-caption">{now === null ? '' : `${formatAge(d.detected_at, now)} ago`}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-surface-200)] px-5 py-3">
            <p className="text-caption">
              {rows.length === 0
                ? 'No rows'
                : `Rows ${offset + 1}–${offset + rows.length}${search.trim() ? ` · ${visible.length} match your search` : ''}`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={offset === 0 || isRefreshing}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={rows.length < PAGE_SIZE || isRefreshing}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && <DiscrepancyPanel key={selected.id} discrepancy={selected} onClose={clearSelection} onResolved={onResolved} />}
      {toast && <Toast message={toast} onClose={closeToast} />}
    </div>
  );
}
