'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useReducedMotion, motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, CheckCircle2, RotateCw } from 'lucide-react';
import { AgingBar, AgingLegend } from '@/components/aging';
import { SeverityLabel, SeverityPip } from '@/components/badges';
import { EmptyState } from '@/components/empty-state';
import { Reveal, rowReveal } from '@/components/motion-primitives';
import { ErrorNotice, PanelError, isConnectionError } from '@/components/notices';
import { MoneyTicker, Ticker } from '@/components/number-ticker';
import { LoadingLabel, PageHeader, SectionHeader, Skeleton } from '@/components/page-header';
import { PspIcon } from '@/components/psp-logos';
import { Segmented } from '@/components/segmented';
import { SEVERITIES, type PipelineRun, type Severity, type TrendDay } from '@/lib/api';
import {
  useDiscrepancies,
  useExposure,
  useExposureAging,
  useNow,
  usePipelineRuns,
  useSummary,
  useTrend,
} from '@/lib/hooks';
import { formatNgn, sumKobo, toKobo } from '@/lib/money';
import {
  KNOWN_FLOWS,
  cn,
  flowLabel,
  formatAge,
  formatCalendarDate,
  formatCount,
  formatDuration,
  formatPercent,
  formatPointsDelta,
  formatTime,
  humanize,
  pspDisplayName,
} from '@/lib/utils';

const TrendChart = dynamic(() => import('@/components/charts/trend-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[280px] w-full" />,
});

const OPEN_FILTERS = { status: 'open' as const, limit: 200, offset: 0 };
const RANGE_OPTIONS = [
  { value: '7', label: '7d', title: 'Last 7 days' },
  { value: '30', label: '30d', title: 'Last 30 days' },
  { value: '90', label: '90d', title: 'Last 90 days' },
] as const;
type Range = (typeof RANGE_OPTIONS)[number]['value'];

// ── Metric cell ──────────────────────────────────────────────────────────────

function Metric({
  label,
  loading,
  children,
  foot,
  href,
}: {
  label: string;
  loading: boolean;
  children: React.ReactNode;
  foot?: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="group relative flex flex-col gap-3 bg-panel px-5 py-5 sm:min-h-[152px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-label">{label}</h2>
        {href && (
          <Link href={href} className="t-caption inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
            <span className="sr-only">{label}: </span>Open
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
      </div>
      {loading ? (
        <>
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-3.5 w-28" />
        </>
      ) : (
        <>
          <div className="t-metric text-[32px] 2xl:text-[36px]">{children}</div>
          {foot && <div className="t-caption mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">{foot}</div>}
        </>
      )}
    </div>
  );
}

function Delta({ value, label, basis }: { value: number; label: string; basis: string }) {
  const tone = Math.abs(value) < 0.05 ? 'text-fg-muted' : value > 0 ? 'text-positive-text' : 'text-critical-text';
  return (
    <span>
      <span className={cn('num font-medium', tone)}>{label}</span> <span>{basis}</span>
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function OverviewView() {
  const [range, setRange] = useState<Range>('30');
  const summary = useSummary();
  const trend = useTrend(Number(range));
  const exposure = useExposure();
  const aging = useExposureAging();
  const open = useDiscrepancies(OPEN_FILTERS, { refreshMs: 60_000 });
  const runs = usePipelineRuns({ limit: 120 });
  const now = useNow();

  const queries = [summary, trend, exposure, aging, open, runs];
  const refreshing = queries.some((q) => q.isRefreshing);
  const refreshAll = () => queries.forEach((q) => q.refetch());
  const connectionError = queries.map((q) => q.error).find((e) => isConnectionError(e)) ?? null;

  const s = summary.data;
  const days = useMemo(() => trend.data?.days ?? [], [trend.data]);
  const today: TrendDay | null = s ? (days.find((d) => d.date === s.report_date) ?? null) : null;
  const prior = s ? (days.filter((d) => d.date < s.report_date && d.match_rate_pct !== null).at(-1) ?? null) : null;
  const rateDelta = s?.match_rate_pct != null && prior?.match_rate_pct != null ? s.match_rate_pct - prior.match_rate_pct : null;
  const avgRate = useMemo(() => {
    const total = days.reduce((n, d) => n + d.total, 0);
    const matched = days.reduce((n, d) => n + d.matched, 0);
    return total ? (matched / total) * 100 : null;
  }, [days]);

  const openRows = useMemo(() => open.data?.discrepancies ?? [], [open.data]);
  const capped = openRows.length >= OPEN_FILTERS.limit;
  const bySeverity = useMemo(() => {
    const counts: Record<Severity | 'none', number> = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
    for (const d of openRows) counts[d.severity ?? 'none'] += 1;
    return counts;
  }, [openRows]);
  const openCount = exposure.data ? exposure.data.by_psp_and_type.reduce((n, e) => n + e.open_count, 0) : null;
  const pspCount = exposure.data ? new Set(exposure.data.by_psp_and_type.map((e) => e.psp_name)).size : 0;
  const attention = useMemo(() => {
    const urgent = openRows.filter((d) => d.severity === 'critical' || d.severity === 'high');
    return (urgent.length ? urgent : openRows).slice(0, 6);
  }, [openRows]);

  const latestByFlow = useMemo(() => {
    const map = new Map<string, PipelineRun>();
    for (const r of runs.data?.runs ?? []) if (!map.has(r.flow_name)) map.set(r.flow_name, r);
    return KNOWN_FLOWS.map((f) => ({ flow: f, run: map.get(f) ?? null }));
  }, [runs.data]);

  return (
    <div className="page space-y-6">
      <PageHeader
        title="Overview"
        description={
          s ? (
            <>
              {formatCalendarDate(s.report_date)}, West Africa Time. Summary generated {formatTime(s.generated_at)}.
            </>
          ) : (
            'Reconciliation across connected PSPs, today and over time.'
          )
        }
        actions={
          <button type="button" onClick={refreshAll} disabled={refreshing} className="btn btn-secondary btn-sm">
            <RotateCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        }
      />

      {connectionError && (
        <ErrorNotice error={connectionError} what="data from the MMR API" onRetry={refreshAll} retrying={refreshing} />
      )}
      {summary.error && !isConnectionError(summary.error) && (
        <ErrorNotice error={summary.error} what="the reconciliation summary" onRetry={summary.refetch} retrying={summary.isRefreshing} staleSince={s ? summary.updatedAt : null} />
      )}

      {/* Headline figures */}
      <section
        aria-label="Headline figures"
        className="grid grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-2 xl:grid-cols-4"
      >
        <Metric
          label="Match rate today"
          loading={summary.isLoading}
          href="/transactions?match_status=unmatched"
          foot={
            <>
              {rateDelta !== null && prior ? (
                <Delta value={rateDelta} label={formatPointsDelta(rateDelta)} basis={`vs ${formatCalendarDate(prior.date, false)}`} />
              ) : s ? (
                <span>
                  {formatCount(s.matched)} of {formatCount(s.total_transactions)} matched
                </span>
              ) : null}
              {avgRate !== null && <span>{`${range}-day ${formatPercent(avgRate)}`}</span>}
            </>
          }
        >
          {s?.match_rate_pct != null ? <Ticker value={s.match_rate_pct} format={(n) => `${n.toFixed(1)}%`} /> : <span className="text-fg-subtle">—</span>}
        </Metric>
        <Metric
          label="Open exposure"
          loading={exposure.isLoading}
          href="/inbox"
          foot={exposure.data ? <span>{`Estimated, across ${pspCount} PSP${pspCount === 1 ? '' : 's'}`}</span> : null}
        >
          {exposure.data ? (
            <MoneyTicker kobo={toKobo(exposure.data.total_open_exposure_ngn) ?? BigInt(0)} />
          ) : (
            <span className="text-fg-subtle">—</span>
          )}
        </Metric>
        <Metric
          label="Unresolved discrepancies"
          loading={exposure.isLoading}
          href="/inbox"
          foot={
            open.data ? (
              <span>
                {SEVERITIES.filter((sev) => bySeverity[sev] > 0 && (sev === 'critical' || sev === 'high'))
                  .map((sev) => `${formatCount(bySeverity[sev])}${capped ? '+' : ''} ${sev}`)
                  .join(', ') || 'None critical or high'}{' in Open'}
              </span>
            ) : null
          }
        >
          {openCount !== null ? <Ticker value={openCount} format={(n) => formatCount(n)} /> : <span className="text-fg-subtle">—</span>}
        </Metric>
        <Metric
          label="Volume today"
          loading={trend.isLoading || summary.isLoading}
          href="/transactions"
          foot={today ? <span>{formatCount(today.total)} transactions so far</span> : null}
        >
          {today ? <MoneyTicker kobo={toKobo(today.volume_ngn) ?? BigInt(0)} /> : <span className="text-fg-subtle">—</span>}
        </Metric>
      </section>

      {/* Trend */}
      <Reveal as="section" className="panel" >
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
          <SectionHeader
            id="trend-heading"
            title="Match rate and volume"
            description={days.length ? `${formatCalendarDate(days[0].date)} to ${formatCalendarDate(days[days.length - 1].date)}, by Lagos calendar day` : 'Daily, by Lagos calendar day'}
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-[12.5px] text-fg-muted max-sm:hidden" aria-hidden="true">
              <span className="inline-flex items-center gap-2">
                <span className="h-[2px] w-3.5 rounded-full bg-accent" />
                Match rate
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--color-chart-bar)]" />
                Volume, relative to the busiest day
              </span>
            </div>
            <Segmented label="Trend range" value={range} options={RANGE_OPTIONS} onChange={setRange} />
          </div>
        </div>
        <div className="px-3 pb-4 pt-3" aria-labelledby="trend-heading">
          {trend.error ? (
            <PanelError error={trend.error} what="the trend" onRetry={trend.refetch} retrying={trend.isRefreshing} />
          ) : trend.isLoading ? (
            <>
              <LoadingLabel what="trend" />
              <Skeleton className="h-[280px] w-full" />
            </>
          ) : days.every((d) => d.total === 0) ? (
            <EmptyState compact title="No reconciled days yet" description="The trend appears once the engine has processed transactions." />
          ) : (
            <>
              <TrendChart days={days} />
              <table className="sr-only">
                <caption>Daily match rate and volume</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Match rate</th>
                    <th scope="col">Matched</th>
                    <th scope="col">Volume</th>
                    <th scope="col">Discrepancies raised</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <th scope="row">{formatCalendarDate(d.date)}</th>
                      <td>{formatPercent(d.match_rate_pct, 2)}</td>
                      <td>
                        {formatCount(d.matched)} of {formatCount(d.total)}
                      </td>
                      <td>{formatNgn(d.volume_ngn)}</td>
                      <td>{formatCount(d.discrepancies_raised)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Needs attention */}
        <Reveal as="section" className="panel lg:col-span-7">
          <div className="px-5 pb-3 pt-5">
            <SectionHeader
              id="attention-heading"
              title="Needs attention"
              description="Open critical and high-severity discrepancies, most severe first"
              actions={
                <Link href="/inbox" className="t-link inline-flex items-center gap-1 text-[13px]">
                  Open inbox <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                </Link>
              }
            />
          </div>
          {open.error ? (
            <PanelError error={open.error} what="open discrepancies" onRetry={open.refetch} retrying={open.isRefreshing} />
          ) : open.isLoading ? (
            <ul className="divide-y divide-line border-t border-line" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="flex h-[60px] items-center gap-3 px-5">
                  <Skeleton className="h-2 w-2" />
                  <span className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </span>
                  <Skeleton className="h-3.5 w-24" />
                </li>
              ))}
            </ul>
          ) : attention.length === 0 ? (
            <EmptyState
              compact
              icon={<CheckCircle2 className="h-5 w-5" strokeWidth={1.5} />}
              title="Nothing needs attention"
              description="There are no open discrepancies. New ones appear here as the matching flow raises them."
            />
          ) : (
            <AttentionList rows={attention} now={now} />
          )}
        </Reveal>

        {/* Exposure aging */}
        <Reveal as="section" className="panel lg:col-span-5" delay={0.04}>
          <div className="px-5 pt-5">
            <SectionHeader id="aging-heading" title="Exposure by age" description="Open exposure, by time since the discrepancy was raised" />
          </div>
          <div className="px-5 pb-5 pt-4">
            {aging.error ? (
              <PanelError error={aging.error} what="exposure aging" onRetry={aging.refetch} retrying={aging.isRefreshing} />
            ) : aging.isLoading ? (
              <div className="space-y-4" aria-hidden="true">
                <Skeleton className="h-2.5 w-full rounded-full" />
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : aging.data && sumKobo(aging.data.buckets.map((b) => b.exposure_ngn)) === BigInt(0) ? (
              <EmptyState compact title="No open exposure" description="Every discrepancy is resolved." />
            ) : aging.data ? (
              <>
                <AgingBar buckets={aging.data.buckets} label="Open exposure by age" />
                <div className="mt-4">
                  <AgingLegend buckets={aging.data.buckets} />
                </div>
                <div className="mt-4 space-y-3 border-t border-line pt-4">
                  {aging.data.by_psp.map((p) => (
                    <div key={p.psp_name} className="grid grid-cols-[112px_1fr] items-center gap-3">
                      <span className="flex items-center gap-2 text-[13px] text-fg-muted">
                        <PspIcon name={p.psp_name} className="h-3.5 w-3.5" />
                        {pspDisplayName(p.psp_name)}
                      </span>
                      <AgingBar buckets={p.buckets} className="h-2" label={`${pspDisplayName(p.psp_name)} open exposure by age`} />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </Reveal>
      </div>

      {/* Pipeline */}
      <Reveal as="section" className="panel">
        <div className="px-5 pb-1 pt-5">
          <SectionHeader
            id="pipeline-heading"
            title="Pipeline"
            description="The latest run of each scheduled flow"
            actions={
              <Link href="/activity" className="t-link inline-flex items-center gap-1 text-[13px]">
                All activity <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </Link>
            }
          />
        </div>
        {runs.error ? (
          <PanelError error={runs.error} what="pipeline runs" onRetry={runs.refetch} retrying={runs.isRefreshing} />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            {latestByFlow.map(({ flow, run }) => (
              <li key={flow} className="border-t border-line px-5 py-4 lg:border-l lg:first:border-l-0">
                <Link href={`/activity?flow=${flow}`} className="group block rounded-[6px]">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    {runs.isLoading ? (
                      <Skeleton className="h-2 w-2 rounded-full" />
                    ) : (
                      <span
                        className={cn(
                          'dot',
                          run?.status === 'completed' && 'dot-ok',
                          run?.status === 'failed' && 'dot-bad',
                          run?.status === 'running' && 'dot-live',
                        )}
                        aria-hidden="true"
                      />
                    )}
                    <span className="group-hover:underline">{flowLabel(flow)}</span>
                  </span>
                  <span className="t-caption mt-1 block num">
                    {runs.isLoading ? (
                      <Skeleton className="mt-1.5 h-3 w-32" />
                    ) : run ? (
                      <>
                        {humanize(run.status)}
                        {run.status === 'running' ? ` for ${formatAge(run.started_at, now)}` : ` ${formatAge(run.started_at, now)} ago`}
                        {run.duration_seconds !== null && ` · ${formatDuration(run.duration_seconds)}`}
                      </>
                    ) : (
                      'No runs recorded'
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </div>
  );
}

function AttentionList({ rows, now }: { rows: NonNullable<ReturnType<typeof useDiscrepancies>['data']>['discrepancies']; now: number | null }) {
  const reduce = useReducedMotion();
  return (
    <ul className="border-t border-line">
      {rows.map((d, i) => (
        <motion.li key={d.id} {...rowReveal(i, reduce)} className="border-b border-line last:border-b-0">
          <Link href={`/inbox?id=${d.id}`} className="flex min-h-[60px] items-center gap-3.5 px-5 py-2.5 transition-colors hover:bg-panel-hover">
            <SeverityPip severity={d.severity} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-fg">{humanize(d.discrepancy_type)}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
                <SeverityLabel severity={d.severity} />
                <PspIcon name={d.psp_name} className="ml-0.5 h-3 w-3" />
                <span className="t-mono truncate">{d.psp_transaction_ref ?? d.transaction_id}</span>
              </span>
            </span>
            <span className="text-right">
              <span className="num block text-[13.5px] font-medium text-fg">{formatNgn(d.estimated_exposure_ngn)}</span>
              <span className="num t-caption block">
                <span className="sr-only">raised </span>
                {formatAge(d.detected_at, now)} ago
              </span>
            </span>
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}
