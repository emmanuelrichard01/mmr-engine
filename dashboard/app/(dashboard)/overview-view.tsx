'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { AreaChartWrapper } from '@/components/charts/area-chart';
import { EmptyState } from '@/components/empty-state';
import { KpiCard, type KpiDelta } from '@/components/kpi-card';
import { ErrorNotice, isConnectionError, PanelError } from '@/components/notices';
import { PageHeader, SectionHeader, Skeleton } from '@/components/page-header';
import { PspName } from '@/components/psp-logos';
import { SeverityBadge } from '@/components/badges';
import { useDiscrepancies, useExposure, useNow, usePspHealth, useSummary, useTrend } from '@/lib/hooks';
import { formatKobo, formatNgn, koboRatio, sumKobo, toKobo } from '@/lib/money';
import {
  cn,
  formatAge,
  formatCalendarDate,
  formatCount,
  formatCountDelta,
  formatPercent,
  formatPointsDelta,
  formatTime,
  humanize,
} from '@/lib/utils';

const ATTENTION_FILTERS = { status: 'open' as const, limit: 5, offset: 0 };

export function OverviewView() {
  const summary = useSummary();
  const trend = useTrend(30);
  const exposure = useExposure();
  const psp = usePspHealth();
  const attention = useDiscrepancies(ATTENTION_FILTERS, { refreshMs: 60_000 });
  const now = useNow();

  const queries = [summary, trend, exposure, psp, attention];
  const refreshing = queries.some((q) => q.isRefreshing);
  const refreshAll = () => queries.forEach((q) => q.refetch());
  const connectionError = queries.map((q) => q.error).find((e) => isConnectionError(e)) ?? null;

  // ── KPI derivations (all from real responses) ──
  const s = summary.data;
  const days = useMemo(() => trend.data?.days ?? [], [trend.data]);
  const priorDay = useMemo(
    () => (s ? days.filter((d) => d.date < s.report_date).at(-1) ?? null : null),
    [days, s],
  );
  const upToReport = useMemo(
    () => (s ? days.filter((d) => d.date <= s.report_date).slice(-14) : []),
    [days, s],
  );

  // Rates are null on days without transactions; no delta is shown then.
  const todayRate = s?.match_rate_pct ?? null;
  const priorRate = priorDay?.match_rate_pct ?? null;
  const matchDelta: KpiDelta | null =
    priorDay && todayRate !== null && priorRate !== null
      ? {
          value: todayRate - priorRate,
          label: formatPointsDelta(todayRate - priorRate),
          basis: `vs ${formatCalendarDate(priorDay.date, false)}`,
        }
      : null;
  const rateSparkline = upToReport.map((d) => d.match_rate_pct).filter((v): v is number => v !== null);
  const rates = useMemo(() => days.map((d) => d.match_rate_pct).filter((v): v is number => v !== null), [days]);
  const txnDelta: KpiDelta | null =
    s && priorDay
      ? {
          value: s.total_transactions - priorDay.total,
          label: formatCountDelta(s.total_transactions - priorDay.total),
          neutral: true,
          basis: `vs ${formatCalendarDate(priorDay.date, false)}`,
        }
      : null;

  const openCount = exposure.data
    ? exposure.data.by_psp_and_type.reduce((n, e) => n + e.open_count, 0)
    : null;

  // ── Trend chart ──
  const chartDomain = useMemo<[number, number]>(() => {
    if (!rates.length) return [0, 100];
    return [Math.max(0, Math.floor(Math.min(...rates) - 1)), 100];
  }, [rates]);

  // ── Exposure by PSP ──
  const pspRows = useMemo(() => {
    const rows = (psp.data?.psps ?? []).map((p) => ({ ...p, kobo: toKobo(p.open_exposure_ngn) ?? BigInt(0) }));
    const max = rows.reduce((m, r) => (r.kobo > m ? r.kobo : m), BigInt(0));
    return rows.map((r) => ({ ...r, ratio: koboRatio(r.kobo, max) }));
  }, [psp.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={
          s ? (
            <>
              Report date {formatCalendarDate(s.report_date)} · summary generated {formatTime(s.generated_at)}
            </>
          ) : (
            'Reconciliation status across connected PSPs'
          )
        }
        actions={
          <button type="button" onClick={refreshAll} disabled={refreshing} className="btn btn-secondary btn-sm">
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {connectionError && (
        <ErrorNotice error={connectionError} what="data from the MMR API" onRetry={refreshAll} retrying={refreshing} />
      )}

      {/* KPIs */}
      <section aria-label="Key figures" className="space-y-3">
        {summary.error && !isConnectionError(summary.error) && (
          <ErrorNotice
            error={summary.error}
            what="the reconciliation summary"
            onRetry={summary.refetch}
            retrying={summary.isRefreshing}
            staleSince={s ? summary.updatedAt : null}
          />
        )}
        {exposure.error && !isConnectionError(exposure.error) && (
          <ErrorNotice
            error={exposure.error}
            what="open exposure"
            onRetry={exposure.refetch}
            retrying={exposure.isRefreshing}
            staleSince={exposure.data ? exposure.updatedAt : null}
          />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Match rate"
            loading={summary.isLoading}
            unavailable={!s}
            value={formatPercent(s?.match_rate_pct)}
            delta={matchDelta}
            sparkline={rateSparkline}
            sparklineLabel="Daily match rate, last 14 days"
          />
          <KpiCard
            label="Open exposure"
            loading={exposure.isLoading}
            unavailable={!exposure.data}
            value={formatNgn(exposure.data?.total_open_exposure_ngn)}
            detail="estimated, all open discrepancies"
          />
          <KpiCard
            label="Open discrepancies"
            loading={exposure.isLoading}
            unavailable={openCount === null}
            value={formatCount(openCount)}
            detail={
              exposure.data
                ? `across ${new Set(exposure.data.by_psp_and_type.map((e) => e.psp_name)).size} PSPs`
                : undefined
            }
          />
          <KpiCard
            label="Transactions"
            loading={summary.isLoading}
            unavailable={!s}
            value={formatCount(s?.total_transactions)}
            delta={txnDelta}
            detail={s ? `${formatCount(s.matched)} matched · ${formatCount(s.unmatched)} unmatched` : undefined}
            sparkline={upToReport.map((d) => d.total)}
            sparklineLabel="Daily transaction count, last 14 days"
          />
        </div>
      </section>

      {/* Trend + exposure by PSP */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="trend-heading">
          <SectionHeader id="trend-heading" title="Match rate" description="Daily, last 30 days" />
          <div className="mt-4">
            {trend.error ? (
              <PanelError error={trend.error} what="the match-rate trend" onRetry={trend.refetch} retrying={trend.isRefreshing} />
            ) : trend.isLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : days.length === 0 ? (
              <EmptyState title="No reconciliation days yet" description="The trend appears once the engine has processed transactions." />
            ) : (
              <AreaChartWrapper
                data={days}
                dataKey="match_rate_pct"
                xKey="date"
                ariaLabel={`Daily match rate from ${formatCalendarDate(days[0].date)} to ${formatCalendarDate(days[days.length - 1].date)}, ${rates.length ? `between ${formatPercent(Math.min(...rates))} and ${formatPercent(Math.max(...rates))}` : 'no days with transactions'}.`}
                yDomain={chartDomain}
                valueFormatter={(v) => formatPercent(v, 2)}
                xTickFormatter={(d) => formatCalendarDate(d, false)}
                yTickFormatter={(v) => `${v}%`}
                tooltipExtra={(row) => `${formatCount(row.matched)} of ${formatCount(row.total)} matched`}
              />
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="psp-exposure-heading">
          <SectionHeader
            id="psp-exposure-heading"
            title="Open exposure by PSP"
            actions={
              <Link href="/psp-health" className="text-link">
                PSP health
              </Link>
            }
          />
          <div className="mt-4">
            {psp.error ? (
              <PanelError error={psp.error} what="PSP health" onRetry={psp.refetch} retrying={psp.isRefreshing} />
            ) : psp.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : pspRows.length === 0 ? (
              <EmptyState title="No PSP activity" description="No events have been received from any PSP yet." />
            ) : (
              <ul className="space-y-4">
                {pspRows.map((p) => (
                  <li key={p.psp_name} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <PspName name={p.psp_name} className="font-medium text-[var(--color-surface-800)]" />
                      <span className="text-financial font-semibold text-[var(--color-surface-900)]">
                        {formatKobo(p.kobo)}
                      </span>
                    </div>
                    <div className="meter" aria-hidden="true">
                      <div className="meter-fill" style={{ width: `${Math.max(p.ratio > 0 ? 2 : 0, p.ratio * 100)}%` }} />
                    </div>
                    <p className="text-caption">
                      {formatCount(p.open_discrepancies)} open · 7-day match rate {formatPercent(p.match_rate_pct_7d)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Needs attention + by type */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card card-flush lg:col-span-2" aria-labelledby="attention-heading">
          <div className="card-section">
            <SectionHeader
              id="attention-heading"
              title="Needs attention"
              description="Open discrepancies, highest severity first"
              actions={
                <Link href="/discrepancies" className="text-link inline-flex items-center gap-1">
                  View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              }
            />
          </div>
          {attention.error ? (
            <div className="card-section pt-0">
              <PanelError
                error={attention.error}
                what="open discrepancies"
                onRetry={attention.refetch}
                retrying={attention.isRefreshing}
              />
            </div>
          ) : attention.isLoading ? (
            <div className="card-section space-y-3 pt-0">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : !attention.data?.discrepancies.length ? (
            <EmptyState title="Nothing open" description="There are no open discrepancies." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Discrepancy</th>
                    <th scope="col">PSP</th>
                    <th scope="col" className="text-right">Amount</th>
                    <th scope="col" className="text-right">Exposure</th>
                    <th scope="col">Severity</th>
                    <th scope="col" className="text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.data.discrepancies.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/discrepancies?id=${d.id}`} className="row-link">
                          <span className="block font-medium">{humanize(d.discrepancy_type)}</span>
                          <span className="text-mono block text-[var(--color-surface-500)]">
                            {d.psp_transaction_ref ?? `Transaction #${d.transaction_id}`}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <PspName name={d.psp_name} />
                      </td>
                      <td className="text-financial text-right">{formatNgn(d.amount_ngn)}</td>
                      <td className="text-financial text-right font-medium">{formatNgn(d.estimated_exposure_ngn)}</td>
                      <td>
                        <SeverityBadge severity={d.severity} />
                      </td>
                      <td className="text-right tabular-nums text-[var(--color-surface-600)]">
                        {formatAge(d.detected_at, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card card-flush" aria-labelledby="types-heading">
          <div className="card-section">
            <SectionHeader
              id="types-heading"
              title="By type"
              description={s ? `Discrepancies on ${formatCalendarDate(s.report_date, false)}` : 'Discrepancies on the report date'}
            />
          </div>
          {summary.isLoading ? (
            <div className="card-section space-y-3 pt-0">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !s ? (
            <p className="card-section pt-0 text-body">Unavailable — the reconciliation summary did not load.</p>
          ) : s.discrepancies.length === 0 ? (
            <EmptyState title="None on this date" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">Count</th>
                  <th scope="col" className="text-right">Exposure</th>
                </tr>
              </thead>
              <tbody>
                {s.discrepancies.map((d) => (
                  <tr key={d.discrepancy_type}>
                    <td>{humanize(d.discrepancy_type)}</td>
                    <td className="text-right tabular-nums">{formatCount(d.count)}</td>
                    <td className="text-financial text-right">{formatNgn(d.total_exposure)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="text-right tabular-nums font-medium">
                    {formatCount(s.discrepancies.reduce((n, d) => n + d.count, 0))}
                  </td>
                  <td className="text-financial text-right font-medium">
                    {formatKobo(sumKobo(s.discrepancies.map((d) => d.total_exposure)))}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
