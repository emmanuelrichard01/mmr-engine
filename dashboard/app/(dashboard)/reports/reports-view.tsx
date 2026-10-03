'use client';

import { useState } from 'react';
import { Download, FileText, Info, RotateCw } from 'lucide-react';
import { ExperimentalBadge } from '@/components/badges';
import { EmptyState } from '@/components/empty-state';
import { ErrorNotice, PanelError } from '@/components/notices';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { TableRowsSkeleton } from '@/components/table-skeleton';
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
  'cross_border_count',
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
    <div className="page space-y-6">
      <PageHeader
        title="Daily return"
        badge={<ExperimentalBadge />}
        description="Each reconciled day, aggregated into a return shaped like a CBN daily report."
        actions={
          <>
            <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
            <button type="button" onClick={() => downloadCsv(rows, offset)} disabled={rows.length === 0} className="btn btn-primary btn-sm">
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              Download CSV
            </button>
          </>
        }
      />

      <div className="notice" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />
        <p className="max-w-[90ch]">
          An experimental module of a reference implementation. Nothing here is filed with, or reviewed by, the Central Bank of Nigeria, and the format has not been validated against current CBN requirements.
        </p>
      </div>

      {error && data && <ErrorNotice error={error} what="daily returns" onRetry={refetch} retrying={isRefreshing} staleSince={updatedAt} />}

      <div className="panel overflow-hidden">
        {error && !data ? (
          <PanelError error={error} what="daily returns" onRetry={refetch} retrying={isRefreshing} />
        ) : !isLoading && rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" strokeWidth={1.5} />}
            title={offset === 0 ? 'No daily returns yet' : 'No older returns'}
            description={offset === 0 ? 'The scheduler generates a return at 02:00 WAT for the previous day.' : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Daily returns, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Report date</th>
                  <th scope="col" className="cell-right">
                    Transactions
                  </th>
                  <th scope="col" className="cell-right">
                    Volume
                  </th>
                  <th scope="col" className="cell-right">
                    Match rate
                  </th>
                  <th scope="col" className="cell-right">
                    Open
                  </th>
                  <th scope="col" className="cell-right">
                    Exposure
                  </th>
                  <th scope="col" className="cell-right">
                    Flags
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Generated (WAT)</th>
                </tr>
              </thead>
              {isLoading ? (
                <TableRowsSkeleton columns={9} rows={10} />
              ) : (
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.report_date}>
                      <th scope="row" className="!font-medium">
                        {formatCalendarDate(r.report_date)}
                      </th>
                      <td className="cell-right num">{formatCount(r.total_transactions)}</td>
                      <td className="cell-right num">{formatNgn(r.total_volume_ngn)}</td>
                      <td className="cell-right num">{formatPercent(r.match_rate_pct, 2)}</td>
                      <td className="cell-right num">{formatCount(r.open_discrepancies)}</td>
                      <td className="cell-right num">{formatNgn(r.total_exposure_ngn)}</td>
                      <td className="cell-right num">{r.suspicious_flags > 0 ? <span className="font-medium text-high-text">{r.suspicious_flags}</span> : <span className="text-fg-subtle">0</span>}</td>
                      <td>
                        <span className={cn('badge', r.status === 'draft' ? 'badge-outline' : 'badge-positive')}>{humanize(r.status)}</span>
                      </td>
                      <td className="num text-fg-muted">{formatDateTime(r.generated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}
        {data && (rows.length > 0 || offset > 0) && (
          <div className="border-t border-line">
            <Pagination offset={offset} pageSize={PAGE_SIZE} shown={rows.length} onChange={setOffset} busy={isRefreshing} noun="returns" />
          </div>
        )}
      </div>
    </div>
  );
}
