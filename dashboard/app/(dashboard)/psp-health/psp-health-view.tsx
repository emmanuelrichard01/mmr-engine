'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { ErrorNotice, PanelError } from '@/components/notices';
import { PageHeader, SectionHeader, Skeleton } from '@/components/page-header';
import { PspIcon, PspName } from '@/components/psp-logos';
import { useExposure, useNow, usePspHealth } from '@/lib/hooks';
import { formatNgn } from '@/lib/money';
import { cn, formatAge, formatCount, formatDateTime, formatPercent, humanize, pspDisplayName } from '@/lib/utils';

export function PspHealthView() {
  const health = usePspHealth();
  const exposure = useExposure();
  const now = useNow();
  const refreshing = health.isRefreshing || exposure.isRefreshing;

  const psps = health.data?.psps ?? [];
  const byPsp = useMemo(() => {
    const rows = exposure.data?.by_psp_and_type ?? [];
    return [...rows].sort((a, b) => a.psp_name.localeCompare(b.psp_name) || b.open_count - a.open_count);
  }, [exposure.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="PSP health"
        description="Event flow and reconciliation quality per payment service provider."
        actions={
          <button
            type="button"
            onClick={() => {
              health.refetch();
              exposure.refetch();
            }}
            disabled={refreshing}
            className="btn btn-secondary btn-sm"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {health.error && (
        <ErrorNotice
          error={health.error}
          what="PSP health"
          onRetry={health.refetch}
          retrying={health.isRefreshing}
          staleSince={health.data ? health.updatedAt : null}
        />
      )}

      {health.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-[188px] w-full rounded-lg" />
          <Skeleton className="h-[188px] w-full rounded-lg" />
        </div>
      ) : health.data && psps.length === 0 ? (
        <div className="card">
          <EmptyState title="No PSP activity yet" description="No webhook events have been ingested from any PSP." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {psps.map((p) => {
            const quiet = p.events_24h === 0;
            return (
              <section key={p.psp_name} className="card" aria-labelledby={`psp-${p.psp_name}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-surface-200)] bg-[var(--color-surface-100)]">
                      <PspIcon name={p.psp_name} className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 id={`psp-${p.psp_name}`} className="text-heading">
                        {pspDisplayName(p.psp_name)}
                      </h2>
                      <p className="text-caption">
                        Last event{' '}
                        {p.last_event_at ? (
                          <time dateTime={p.last_event_at} title={formatDateTime(p.last_event_at)}>
                            {now === null ? formatDateTime(p.last_event_at) : `${formatAge(p.last_event_at, now)} ago`}
                          </time>
                        ) : (
                          'never'
                        )}
                      </p>
                    </div>
                  </div>
                  {quiet ? (
                    <span className="badge badge-warning">No events in 24h</span>
                  ) : (
                    <span className="badge badge-neutral">Receiving events</span>
                  )}
                </div>

                <dl className="stat-grid mt-4">
                  <div>
                    <dt>Events, last 24h</dt>
                    <dd>{formatCount(p.events_24h)}</dd>
                  </div>
                  <div>
                    <dt>Match rate, 7 days</dt>
                    <dd>{formatPercent(p.match_rate_pct_7d)}</dd>
                  </div>
                  <div>
                    <dt>Open discrepancies</dt>
                    <dd>{formatCount(p.open_discrepancies)}</dd>
                  </div>
                  <div>
                    <dt>Open exposure</dt>
                    <dd className="text-financial">{formatNgn(p.open_exposure_ngn)}</dd>
                  </div>
                </dl>
              </section>
            );
          })}
        </div>
      )}

      <section className="card card-flush" aria-labelledby="exposure-breakdown">
        <div className="card-section">
          <SectionHeader
            id="exposure-breakdown"
            title="Open exposure by PSP and type"
            description={
              exposure.data ? `Generated ${formatDateTime(exposure.data.generated_at)}` : 'Estimated exposure of open discrepancies'
            }
          />
        </div>
        {exposure.error ? (
          <div className="card-section pt-0">
            <PanelError error={exposure.error} what="exposure" onRetry={exposure.refetch} retrying={exposure.isRefreshing} />
          </div>
        ) : exposure.isLoading ? (
          <div className="card-section space-y-3 pt-0">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : byPsp.length === 0 ? (
          <EmptyState title="No open exposure" description="There are no open discrepancies." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">PSP</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">Open</th>
                  <th scope="col" className="text-right">Exposure</th>
                </tr>
              </thead>
              <tbody>
                {byPsp.map((e) => (
                  <tr key={`${e.psp_name}-${e.discrepancy_type}`}>
                    <td>
                      <PspName name={e.psp_name} />
                    </td>
                    <td>{humanize(e.discrepancy_type)}</td>
                    <td className="text-right tabular-nums">{formatCount(e.open_count)}</td>
                    <td className="text-financial text-right">{formatNgn(e.total_exposure_ngn)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Total open exposure
                  </th>
                  <td className="text-financial text-right font-semibold">
                    {formatNgn(exposure.data?.total_open_exposure_ngn)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
