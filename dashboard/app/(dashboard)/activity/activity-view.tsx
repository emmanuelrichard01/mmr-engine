'use client';

import { Fragment, useState } from 'react';
import { ChevronRight, History, RotateCw } from 'lucide-react';
import { RunStatusBadge } from '@/components/badges';
import { EmptyState } from '@/components/empty-state';
import { FilterSelect } from '@/components/filter-select';
import { ErrorNotice, PanelError } from '@/components/notices';
import { PageHeader, Skeleton } from '@/components/page-header';
import { Segmented } from '@/components/segmented';
import { TableRowsSkeleton } from '@/components/table-skeleton';
import type { PipelineRun } from '@/lib/api';
import { useNow, usePipelineRuns } from '@/lib/hooks';
import { param } from '@/lib/url-state';
import { useUrlState } from '@/lib/use-url-state';
import { KNOWN_FLOWS, cn, flowLabel, formatAge, formatCount, formatDateTime, formatDuration, formatShortDateTime, humanize } from '@/lib/utils';

const RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;
const SCHEMA = {
  flow: param.enum(KNOWN_FLOWS),
  status: param.enum(RUN_STATUSES),
};
const LIMIT = 100;

function runDuration(r: PipelineRun, now: number | null): string {
  if (r.duration_seconds !== null) return formatDuration(r.duration_seconds);
  if (r.status === 'running' && now !== null) return `${formatDuration((now - Date.parse(r.started_at)) / 1000)} so far`;
  return '—';
}

/** The last runs of one flow: current state, when, and how many of the recent runs succeeded. */
function FlowGlance({ flow, active, onSelect, now }: { flow: (typeof KNOWN_FLOWS)[number]; active: boolean; onSelect: () => void; now: number | null }) {
  const { data, isLoading, error } = usePipelineRuns({ limit: 20, flow_name: flow }, { refreshMs: 30_000 });
  const runs = data?.runs ?? [];
  const last = runs[0] ?? null;
  const finished = runs.filter((r) => r.status === 'completed' || r.status === 'failed');
  const ok = finished.filter((r) => r.status === 'completed').length;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn('flex flex-col items-start gap-2 bg-panel px-5 py-4 text-left transition-colors hover:bg-panel-hover', active && 'bg-accent-soft hover:bg-accent-soft')}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-fg">{flowLabel(flow)}</span>
        {isLoading ? <Skeleton className="h-5 w-16" /> : last ? <RunStatusBadge status={last.status} /> : null}
      </span>
      <span className="t-caption num">
        {isLoading ? (
          <Skeleton className="h-3 w-32" />
        ) : error ? (
          'Unavailable'
        ) : last ? (
          last.status === 'running' ? `Running for ${formatAge(last.started_at, now)}` : `Last run ${formatAge(last.started_at, now)} ago, ${formatDuration(last.duration_seconds)}`
        ) : (
          'No runs recorded'
        )}
      </span>
      {!isLoading && finished.length > 0 && (
        // A fixed run of 20 slots, newest on the right; slots without a run stay empty.
        <span className="flex w-full items-center justify-end gap-[3px]" role="img" aria-label={`${ok} of the last ${finished.length} finished runs succeeded`}>
          {Array.from({ length: 20 }, (_, i) => {
            const r = finished.slice(0, 20).reverse()[i - (20 - Math.min(20, finished.length))];
            return (
              <span
                key={i}
                className={cn('h-3 w-1.5 rounded-[2px]', !r ? 'bg-inset' : r.status === 'completed' ? 'bg-positive/70' : 'bg-critical')}
              />
            );
          })}
        </span>
      )}
    </button>
  );
}

export function ActivityView() {
  const [params, setParams] = useUrlState(SCHEMA);
  const now = useNow(15_000);
  const { data, error, isLoading, isRefreshing, refetch, updatedAt } = usePipelineRuns({ limit: LIMIT, flow_name: params.flow });
  const all = data?.runs ?? [];
  const runs = params.status ? all.filter((r) => r.status === params.status) : all;
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="page space-y-6">
      <PageHeader
        title="Activity"
        description="Every scheduled flow and the consumer, as recorded in system_pipeline_runs."
        actions={
          <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
            <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
        }
      />

      <section aria-label="Flows" className="grid grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {KNOWN_FLOWS.map((f) => (
          <FlowGlance key={f} flow={f} now={now} active={params.flow === f} onSelect={() => setParams({ flow: params.flow === f ? undefined : f })} />
        ))}
      </section>

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Flow" anyLabel="All flows" value={params.flow} onChange={(flow) => setParams({ flow })} options={KNOWN_FLOWS.map((f) => ({ value: f, label: flowLabel(f) }))} />
            <Segmented
              label="Run status"
              value={params.status ?? 'all'}
              onChange={(v) => setParams({ status: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'All' }, ...RUN_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]}
            />
          </div>
          <p className="t-caption">
            {data ? `Latest ${formatCount(all.length)} runs${params.flow ? ` of ${flowLabel(params.flow)}` : ''}` : ''}
          </p>
        </div>

        {error && data && <ErrorNotice error={error} what="pipeline runs" onRetry={refetch} retrying={isRefreshing} staleSince={updatedAt} className="m-3" />}

        {error && !data ? (
          <PanelError error={error} what="pipeline runs" onRetry={refetch} retrying={isRefreshing} />
        ) : !isLoading && runs.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" strokeWidth={1.5} />}
            title={params.status ? `No ${params.status} runs` : 'No runs recorded'}
            description={params.status ? 'None of the latest runs are in this state.' : 'Runs appear once the scheduler and consumer start. Each run writes a row to system_pipeline_runs.'}
          />
        ) : (
          <div className="table-wrap max-h-[calc(100dvh-380px)] min-h-[320px]">
            <table className="table">
              <caption className="sr-only">Pipeline runs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col" className="!pl-[calc(var(--cell-x)+20px)]">
                    Flow
                  </th>
                  <th scope="col">Started (WAT)</th>
                  <th scope="col" className="cell-right">
                    Duration
                  </th>
                  <th scope="col" className="cell-right">
                    Processed
                  </th>
                  <th scope="col" className="cell-right">
                    Failed
                  </th>
                  <th scope="col">Triggered by</th>
                </tr>
              </thead>
              {isLoading ? (
                <TableRowsSkeleton columns={7} rows={12} />
              ) : (
                <tbody>
                  {runs.map((r) => {
                    const open = expanded === r.id;
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td>
                            <RunStatusBadge status={r.status} />
                          </td>
                          <td>
                            {r.error_message ? (
                              <button type="button" className="inline-flex items-center gap-1.5 rounded-[4px] font-medium text-fg" aria-expanded={open} onClick={() => setExpanded(open ? null : r.id)}>
                                <ChevronRight className={cn('h-3.5 w-3.5 text-fg-subtle transition-transform', open && 'rotate-90')} strokeWidth={1.75} aria-hidden="true" />
                                {flowLabel(r.flow_name)}
                                <span className="sr-only">, show error</span>
                              </button>
                            ) : (
                              <span className="pl-5 font-medium">{flowLabel(r.flow_name)}</span>
                            )}
                          </td>
                          <td className="num text-fg-muted" title={formatDateTime(r.started_at)}>
                            {formatShortDateTime(r.started_at)}
                            <span className="t-caption ml-2">{formatAge(r.started_at, now)} ago</span>
                          </td>
                          <td className="cell-right num">{runDuration(r, now)}</td>
                          <td className="cell-right num">{formatCount(r.records_processed)}</td>
                          <td className="cell-right num">{r.records_failed > 0 ? <span className="font-medium text-critical-text">{formatCount(r.records_failed)}</span> : <span className="text-fg-subtle">0</span>}</td>
                          <td className="text-fg-muted">{r.triggered_by ?? '—'}</td>
                        </tr>
                        {open && r.error_message && (
                          <tr>
                            <td colSpan={7} className="!h-auto bg-inset !py-3">
                              <p className="t-caption mb-1">Error</p>
                              <p className="t-mono whitespace-pre-wrap break-words text-critical-text">{r.error_message}</p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
