'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { ExperimentalBadge } from '@/components/badges';
import { EmptyState } from '@/components/empty-state';
import { ErrorNotice } from '@/components/notices';
import { PageHeader, Skeleton } from '@/components/page-header';
import type { DailyReport } from '@/lib/api';
import { useDailyReports } from '@/lib/hooks';
import { formatNgn } from '@/lib/money';
import { cn, formatCalendarDate, formatCount, formatDateTime, formatPercent, humanize } from '@/lib/utils';

const PAGE_SIZE = 30;

const CSV_COLUMNS: (keyof DailyReport)[] = [
  'report_date',
  'total_transactions',
  'total_volume_ngn',
  'match_rate_pct',
  'suspicious_flags',
  'open_discrepancies',
  'total_exposure_ngn',
  'status',
  'generated_at',
];

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Client-side CSV of exactly the rows on screen; values are written as the API returned them. */
function downloadCsv(rows: DailyReport[], offset: number) {
  const lines = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))];
  const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const first = rows[rows.length - 1]?.report_date ?? 'none';
  const last = rows[0]?.report_date ?? 'none';
  a.href = url;
  a.download = `mmr-daily-return_${first}_to_${last}${offset ? `_offset-${offset}` : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReportsView() {
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading, isRefreshing, refetch, updatedAt } = useDailyReports({ limit: PAGE_SIZE, offset });
  const rows = data?.reports ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily return"
        badge={<ExperimentalBadge />}
        description="CBN-style daily return (experimental — not a compliance product)."
        actions={
          <>
            <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => downloadCsv(rows, offset)}
              disabled={rows.length === 0}
              className="btn btn-primary btn-sm"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download CSV
            </button>
          </>
        }
      />

      <div className="notice notice-info" role="note">
        <p>
          The engine aggregates each reconciled day into a return shaped like a regulated institution’s daily report. It
          is an experimental module of a reference implementation: nothing here is filed with, or reviewed by, the
          Central Bank of Nigeria, and the format has not been validated against current CBN requirements.
        </p>
      </div>

      {error && (
        <ErrorNotice
          error={error}
          what="daily returns"
          onRetry={refetch}
          retrying={isRefreshing}
          staleSince={data ? updatedAt : null}
        />
      )}

      <div className="card card-flush">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !data ? (
          <EmptyState title="No data" description="Daily returns could not be loaded." />
        ) : rows.length === 0 ? (
          <EmptyState
            title={offset === 0 ? 'No daily returns generated yet' : 'No more returns'}
            description={offset === 0 ? 'Returns appear here after the engine’s daily report job has run.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <caption className="sr-only">Daily returns, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Report date</th>
                  <th scope="col" className="text-right">Transactions</th>
                  <th scope="col" className="text-right">Volume</th>
                  <th scope="col" className="text-right">Match rate</th>
                  <th scope="col" className="text-right">Open discrepancies</th>
                  <th scope="col" className="text-right">Exposure</th>
                  <th scope="col" className="text-right">Suspicious flags</th>
                  <th scope="col">Status</th>
                  <th scope="col">Generated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.report_date}>
                    <th scope="row" className="font-medium">
                      {formatCalendarDate(r.report_date)}
                    </th>
                    <td className="text-right tabular-nums">{formatCount(r.total_transactions)}</td>
                    <td className="text-financial text-right">{formatNgn(r.total_volume_ngn)}</td>
                    <td className="text-right tabular-nums">{formatPercent(r.match_rate_pct, 2)}</td>
                    <td className="text-right tabular-nums">{formatCount(r.open_discrepancies)}</td>
                    <td className="text-financial text-right">{formatNgn(r.total_exposure_ngn)}</td>
                    <td className="text-right tabular-nums">{formatCount(r.suspicious_flags)}</td>
                    <td>
                      <span className="badge badge-neutral">{humanize(r.status)}</span>
                    </td>
                    <td className="whitespace-nowrap text-[var(--color-surface-600)]">{formatDateTime(r.generated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-surface-200)] px-5 py-3">
            <p className="text-caption">
              {rows.length === 0 ? 'No rows' : `Rows ${offset + 1}–${offset + rows.length}, newest first`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={offset === 0 || isRefreshing}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Newer
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={rows.length < PAGE_SIZE || isRefreshing}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Older <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
