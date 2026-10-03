'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Radio, RotateCw } from 'lucide-react';
import { AgingBar } from '@/components/aging';
import { EmptyState } from '@/components/empty-state';
import { Reveal } from '@/components/motion-primitives';
import { ErrorNotice, PanelError } from '@/components/notices';
import { Ticker } from '@/components/number-ticker';
import { PageHeader, SectionHeader, Skeleton } from '@/components/page-header';
import { PspIcon, PspName } from '@/components/psp-logos';
import type { AgingBucketRow, PspHealth } from '@/lib/api';
import { useExposure, useExposureAging, useNow, usePspHealth } from '@/lib/hooks';
import { formatNgn } from '@/lib/money';
import { cn, formatAge, formatCount, formatDateTime, formatPercent, humanize, minutesSince, pspDisplayName } from '@/lib/utils';

type Freshness = 'live' | 'quiet' | 'stale' | 'unknown';

/** Live: an event in the last 15 minutes. Quiet: within 2 hours. Stale: older, or none in 24 hours. */
function freshnessOf(p: PspHealth, now: number | null): Freshness {
  const mins = minutesSince(p.last_event_at, now);
  if (mins === null) return p.last_event_at ? 'unknown' : 'stale';
  if (p.events_24h === 0 || mins > 120) return 'stale';
  if (mins > 15) return 'quiet';
  return 'live';
}

const FRESH_LABEL: Record<Freshness, string> = { live: 'Live', quiet: 'Quiet', stale: 'Stale', unknown: 'Checking' };
const FRESH_DOT: Record<Freshness, string> = { live: 'dot-ok', quiet: 'dot-warn', stale: 'dot-bad', unknown: '' };
const FRESH_BADGE: Record<Freshness, string> = { live: 'badge-positive', quiet: 'badge-medium', stale: 'badge-critical', unknown: '' };

/**
 * Where the last event sits on a log time scale from 1 minute to 24 hours,
 * against the live / quiet / stale thresholds.
 */
function FreshnessScale({ minutes, label }: { minutes: number | null; label: string }) {
  const pos = (m: number) => Math.min(1, Math.max(0, Math.log(Math.max(1, m)) / Math.log(24 * 60)));
  const marker = minutes === null ? null : pos(minutes);
  return (
    <div>
      <div className="relative" role="img" aria-label={label}>
        <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full">
          <span className="h-full bg-positive/70" style={{ width: `${pos(15) * 100}%` }} />
          <span className="h-full bg-medium/70" style={{ width: `${(pos(120) - pos(15)) * 100}%` }} />
          <span className="h-full flex-1 bg-critical/60" />
        </div>
        {marker !== null && (
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-fg shadow-sm"
            style={{ left: `${marker * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="t-caption mt-2 flex justify-between" aria-hidden="true">
        <span>1m</span>
        <span>15m</span>
        <span>2h</span>
        <span>24h</span>
      </div>
    </div>
  );
}

function PspCard({ p, aging, now }: { p: PspHealth; aging: AgingBucketRow[] | null; now: number | null }) {
  const fresh = freshnessOf(p, now);
  const mins = minutesSince(p.last_event_at, now);
  const lastLabel = p.last_event_at ? (now === null ? formatDateTime(p.last_event_at) : `${formatAge(p.last_event_at, now)} ago`) : 'never';
  return (
    <section className="panel flex flex-col" aria-labelledby={`psp-${p.psp_name}`}>
      <div className="flex items-start justify-between gap-3 px-6 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-inset" aria-hidden="true">
            <PspIcon name={p.psp_name} className="h-5 w-5" />
          </span>
          <div>
            <h2 id={`psp-${p.psp_name}`} className="t-title text-[16px]">
              {pspDisplayName(p.psp_name)}
            </h2>
            <p className="t-caption num">
              Last event <time dateTime={p.last_event_at ?? undefined} title={formatDateTime(p.last_event_at)}>{lastLabel}</time>
            </p>
          </div>
        </div>
        <span className={cn('badge', FRESH_BADGE[fresh])}>
          <span className={cn('dot h-1.5 w-1.5', FRESH_DOT[fresh], fresh === 'live' && 'dot-live bg-positive')} aria-hidden="true" />
          {FRESH_LABEL[fresh]}
        </span>
      </div>

      <div className="px-6 pt-6">
        <p className="t-label">Events, last 24 hours</p>
        <p className="t-metric mt-2 text-[36px]">
          <Ticker value={p.events_24h} format={(n) => formatCount(n)} />
        </p>
      </div>

      <div className="px-6 pt-5">
        <FreshnessScale minutes={mins} label={`Event freshness: last event ${lastLabel}. Live under 15 minutes, quiet under 2 hours, stale after.`} />
      </div>

      <dl className="mt-6 grid grid-cols-3 border-t border-line">
        <div className="px-6 py-4">
          <dt className="t-caption">Match rate, 7 days</dt>
          <dd className="num mt-1 text-[15px] font-semibold text-fg">{formatPercent(p.match_rate_pct_7d)}</dd>
        </div>
        <div className="border-l border-line px-6 py-4">
          <dt className="t-caption">Open</dt>
          <dd className="num mt-1 text-[15px] font-semibold text-fg">{formatCount(p.open_discrepancies)}</dd>
        </div>
        <div className="border-l border-line px-6 py-4">
          <dt className="t-caption">Open exposure</dt>
          <dd className="num mt-1 truncate text-[15px] font-semibold text-fg" title={formatNgn(p.open_exposure_ngn)}>
            {formatNgn(p.open_exposure_ngn)}
          </dd>
        </div>
      </dl>

      {aging && (
        <div className="border-t border-line px-6 py-4">
          <p className="t-caption mb-2.5">Open exposure by age</p>
          <AgingBar buckets={aging} label={`${pspDisplayName(p.psp_name)} open exposure by age`} className="h-2" />
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-6 py-3.5 text-[13px]">
        <Link href={`/inbox?psp=${p.psp_name}`} className="t-link inline-flex items-center gap-1">
          Open discrepancies <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <Link href={`/transactions?psp=${p.psp_name}`} className="t-link inline-flex items-center gap-1">
          Transactions <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

export function PspHealthView() {
  const health = usePspHealth();
  const exposure = useExposure();
  const aging = useExposureAging();
  const now = useNow(30_000);
  const refreshing = health.isRefreshing || exposure.isRefreshing || aging.isRefreshing;

  const psps = health.data?.psps ?? [];
  const byPsp = useMemo(() => {
    const rows = exposure.data?.by_psp_and_type ?? [];
    return [...rows].sort((a, b) => a.psp_name.localeCompare(b.psp_name) || b.open_count - a.open_count);
  }, [exposure.data]);

  return (
    <div className="page space-y-6">
      <PageHeader
        title="PSP health"
        description="Event flow and reconciliation quality for each payment service provider."
        actions={
          <button
            type="button"
            onClick={() => {
              health.refetch();
              exposure.refetch();
              aging.refetch();
            }}
            disabled={refreshing}
            className="btn btn-secondary btn-sm"
          >
            <RotateCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        }
      />

      {health.error && <ErrorNotice error={health.error} what="PSP health" onRetry={health.refetch} retrying={health.isRefreshing} staleSince={health.data ? health.updatedAt : null} />}

      {health.isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-busy="true">
          <span role="status" className="sr-only">
            Loading PSP health
          </span>
          {[0, 1].map((i) => (
            <div key={i} className="panel space-y-6 p-6">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-[10px]" />
                <span className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-36" />
                </span>
              </div>
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            </div>
          ))}
        </div>
      ) : health.data && psps.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Radio className="h-5 w-5" strokeWidth={1.5} />} title="No PSP activity yet" description="Cards appear here once webhooks from Paystack or Flutterwave have been ingested." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {psps.map((p) => (
            <PspCard key={p.psp_name} p={p} now={now} aging={aging.data?.by_psp.find((a) => a.psp_name === p.psp_name)?.buckets ?? null} />
          ))}
        </div>
      )}

      <Reveal as="section" className="panel overflow-hidden">
        <div className="px-5 pb-4 pt-5">
          <SectionHeader
            id="exposure-breakdown"
            title="Open exposure by PSP and type"
            description={exposure.data ? `Estimated exposure of open discrepancies, generated ${formatDateTime(exposure.data.generated_at)}` : 'Estimated exposure of open discrepancies'}
          />
        </div>
        {exposure.error ? (
          <PanelError error={exposure.error} what="exposure" onRetry={exposure.refetch} retrying={exposure.isRefreshing} />
        ) : exposure.isLoading ? (
          <div className="space-y-3 px-5 pb-5" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : byPsp.length === 0 ? (
          <EmptyState compact title="No open exposure" description="There are no open discrepancies." />
        ) : (
          <div className="table-wrap border-t border-line">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">PSP</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="cell-right">
                    Open
                  </th>
                  <th scope="col" className="cell-right">
                    Exposure
                  </th>
                </tr>
              </thead>
              <tbody>
                {byPsp.map((e) => (
                  <tr key={`${e.psp_name}-${e.discrepancy_type}`}>
                    <td>
                      <PspName name={e.psp_name} />
                    </td>
                    <td className="text-fg-muted">{humanize(e.discrepancy_type)}</td>
                    <td className="cell-right num">{formatCount(e.open_count)}</td>
                    <td className="cell-right num font-medium">{formatNgn(e.total_exposure_ngn)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Total open exposure
                  </th>
                  <td className="cell-right num">{formatNgn(exposure.data?.total_open_exposure_ngn)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Reveal>
    </div>
  );
}
