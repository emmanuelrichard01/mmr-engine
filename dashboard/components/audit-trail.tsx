'use client';

import type { DiscrepancyEvent } from '@/lib/api';
import { useDiscrepancyEvents } from '@/lib/hooks';
import { formatDateTime, humanize } from '@/lib/utils';
import { PanelError } from './notices';
import { Skeleton } from './page-header';

const EVENT_LABEL: Record<string, string> = {
  raised: 'Raised by the engine',
  severity_changed: 'Severity changed',
  resolved: 'Resolved',
  marked_false_positive: 'Marked false positive',
  escalated: 'Escalated',
  reopened: 'Reopened',
};

const EVENT_TONE: Record<string, string> = {
  raised: 'accent',
  resolved: 'positive',
  marked_false_positive: 'muted',
  escalated: 'critical',
};

/** Append-only history from GET /discrepancies/{id}/events, plus any change still being saved. */
export function AuditTrail({ id, pending }: { id: string; pending?: DiscrepancyEvent | null }) {
  const { data, error, isLoading, isRefreshing, refetch } = useDiscrepancyEvents(id);
  const events = [...(data?.events ?? []), ...(pending ? [pending] : [])];

  if (error) return <PanelError error={error} what="the audit trail" onRetry={refetch} retrying={isRefreshing} className="py-6" />;
  if (isLoading && !pending) {
    return (
      <div className="space-y-4" aria-hidden="true">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-4 w-4 rounded-full" />
            <span className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (events.length === 0) return <p className="t-body text-[13px]">No events recorded.</p>;

  return (
    <ol className="timeline">
      {events.map((ev, i) => {
        const isPending = pending && i === events.length - 1;
        return (
          <li key={`${ev.occurred_at}-${i}`} aria-busy={isPending || undefined}>
            <span className="timeline-node" data-tone={EVENT_TONE[ev.action] ?? undefined} aria-hidden="true" />
            <p className="text-[13px] font-medium text-fg">
              {EVENT_LABEL[ev.action] ?? humanize(ev.action)}
              {ev.from_status && ev.to_status && ev.from_status !== ev.to_status && ev.action !== 'raised' && (
                <span className="font-normal text-fg-subtle">
                  {' '}
                  ({humanize(ev.from_status).toLowerCase()} to {humanize(ev.to_status).toLowerCase()})
                </span>
              )}
            </p>
            <p className="t-caption mt-0.5">
              {isPending ? (
                'Saving'
              ) : (
                <>
                  <time dateTime={ev.occurred_at}>{formatDateTime(ev.occurred_at)}</time>
                  {ev.actor ? ` by ${ev.actor}` : ''}
                </>
              )}
            </p>
            {ev.note && <p className="mt-2 whitespace-pre-wrap rounded-[8px] bg-inset px-3 py-2 text-[13px] leading-relaxed text-fg-muted">{ev.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}
