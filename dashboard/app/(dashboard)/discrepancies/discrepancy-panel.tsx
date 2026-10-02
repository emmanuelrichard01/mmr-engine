'use client';

import { useId, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { SeverityBadge, StatusBadge } from '@/components/badges';
import { PspName } from '@/components/psp-logos';
import { ErrorNotice } from '@/components/notices';
import { Skeleton } from '@/components/page-header';
import { DEMO_MODE, MIN_RESOLUTION_NOTE, type Discrepancy, type ResolveOutcome, type ResolveResponse } from '@/lib/api';
import { useDiscrepancyEvents, useResolveDiscrepancy } from '@/lib/hooks';
import { formatNgn } from '@/lib/money';
import { useModal } from '@/lib/use-modal';
import { formatDateTime, humanize } from '@/lib/utils';

export function DiscrepancyPanel({
  discrepancy: d,
  onClose,
  onResolved,
}: {
  discrepancy: Discrepancy;
  onClose: () => void;
  onResolved: (result: ResolveResponse) => void;
}) {
  const ref = useModal<HTMLDivElement>(true, onClose);
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-slide-in-right relative flex h-full w-full max-w-[480px] flex-col border-l border-[var(--color-surface-200)] bg-[var(--color-surface-0)] shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-surface-200)] p-5">
          <div className="min-w-0">
            <p className="text-caption">Discrepancy #{d.id}</p>
            <h2 id={titleId} className="mt-1 text-[18px] font-semibold tracking-tight text-[var(--color-surface-900)]">
              {humanize(d.discrepancy_type)}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SeverityBadge severity={d.severity} />
              <StatusBadge status={d.status} />
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close discrepancy details">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <dl className="detail-grid">
            <div>
              <dt>Transaction amount</dt>
              <dd className="text-financial text-[16px] font-semibold">{formatNgn(d.amount_ngn)}</dd>
            </div>
            <div>
              <dt>Estimated exposure</dt>
              <dd className="text-financial text-[16px] font-semibold">{formatNgn(d.estimated_exposure_ngn)}</dd>
            </div>
            <div>
              <dt>PSP</dt>
              <dd>
                <PspName name={d.psp_name} />
              </dd>
            </div>
            <div>
              <dt>PSP reference</dt>
              <dd className="text-mono break-all">{d.psp_transaction_ref ?? '—'}</dd>
            </div>
            <div>
              <dt>Transaction ID</dt>
              <dd className="text-mono">{d.transaction_id}</dd>
            </div>
            <div>
              <dt>Detected</dt>
              <dd>{formatDateTime(d.detected_at)}</dd>
            </div>
            {d.resolved_at && (
              <div>
                <dt>Resolved</dt>
                <dd>{formatDateTime(d.resolved_at)}</dd>
              </div>
            )}
            {d.resolved_by && (
              <div>
                <dt>Resolved by</dt>
                <dd>{d.resolved_by}</dd>
              </div>
            )}
          </dl>

          {d.resolution_note && (
            <div>
              <h3 className="text-overline mb-2">Resolution note</h3>
              <p className="text-body whitespace-pre-wrap text-[var(--color-surface-800)]">{d.resolution_note}</p>
            </div>
          )}

          <div>
            <h3 className="text-overline mb-2">Evidence</h3>
            {d.evidence && Object.keys(d.evidence).length > 0 ? (
              <pre className="code-block">{JSON.stringify(d.evidence, null, 2)}</pre>
            ) : (
              <p className="text-body">No evidence recorded for this discrepancy.</p>
            )}
          </div>

          <AuditTrail id={d.id} />
        </div>

        {(d.status === 'open' || d.status === 'under_review' || d.status === 'escalated') && (
          <ResolveForm id={d.id} onResolved={onResolved} />
        )}
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  raised: 'Raised',
  severity_changed: 'Severity changed',
  resolved: 'Resolved',
  marked_false_positive: 'Marked false positive',
  escalated: 'Escalated',
  reopened: 'Reopened',
};

/** The real audit trail from GET /discrepancies/{id}/events. */
function AuditTrail({ id }: { id: number }) {
  const { data, error, isLoading, isRefreshing, refetch } = useDiscrepancyEvents(id);
  const events = data?.events ?? [];

  return (
    <div>
      <h3 className="text-overline mb-2">Audit trail</h3>
      {error ? (
        <ErrorNotice error={error} what="the audit trail" onRetry={refetch} retrying={isRefreshing} />
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-body">No events recorded.</p>
      ) : (
        <ol className="timeline">
          {events.map((ev, i) => (
            <li key={`${ev.occurred_at}-${i}`}>
              <p className="text-[13px] font-medium text-[var(--color-surface-900)]">
                {EVENT_LABEL[ev.action] ?? humanize(ev.action)}
                {ev.from_status && ev.to_status && ev.from_status !== ev.to_status && (
                  <span className="font-normal text-[var(--color-surface-600)]">
                    {' '}
                    · {humanize(ev.from_status)} → {humanize(ev.to_status)}
                  </span>
                )}
              </p>
              <p className="text-caption">
                <time dateTime={ev.occurred_at}>{formatDateTime(ev.occurred_at)}</time>
                {ev.actor ? ` · ${ev.actor}` : ''}
              </p>
              {ev.note && <p className="text-body mt-1 whitespace-pre-wrap">{ev.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ResolveForm({ id, onResolved }: { id: number; onResolved: (result: ResolveResponse) => void }) {
  const { resolve, isResolving, error } = useResolveDiscrepancy();
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<ResolveOutcome>('resolved');
  const [touched, setTouched] = useState(false);
  const noteId = useId();
  const hintId = useId();
  const errorId = useId();

  const trimmed = note.trim();
  const tooShort = trimmed.length < MIN_RESOLUTION_NOTE;
  const showValidation = touched && tooShort;

  if (DEMO_MODE) {
    return (
      <p className="text-body border-t border-[var(--color-surface-200)] bg-[var(--color-surface-50)] p-5">
        Resolving is disabled in demo mode — there is no engine to write to.
      </p>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (tooShort || isResolving) return;
    const result = await resolve(id, trimmed, outcome);
    if (result) onResolved(result);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 border-t border-[var(--color-surface-200)] bg-[var(--color-surface-50)] p-5">
      <fieldset className="field">
        <legend>Outcome</legend>
        <div className="segmented w-full">
          {(
            [
              ['resolved', 'Resolved'],
              ['false_positive', 'False positive'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={outcome === value}
              onClick={() => setOutcome(value)}
              className="segmented-item flex-1"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label htmlFor={noteId} className="block text-[13px] font-semibold text-[var(--color-surface-900)]">
        Resolution note
      </label>
      <textarea
        id={noteId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => setTouched(true)}
        rows={3}
        aria-invalid={showValidation}
        aria-describedby={`${hintId}${showValidation || error ? ` ${errorId}` : ''}`}
        placeholder="What was found and how it was settled, e.g. the PSP settlement reference."
        className="textarea"
      />
      <p id={hintId} className="text-caption">
        {`Recorded in the audit trail. At least ${MIN_RESOLUTION_NOTE} characters (${trimmed.length} so far).`}
      </p>
      {(showValidation || error) && (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-[var(--color-danger-600)]">
          {showValidation
            ? `The note must be at least ${MIN_RESOLUTION_NOTE} characters.`
            : error?.status
              ? `The API rejected this (HTTP ${error.status}): ${error.detail}`
              : error?.detail}
        </p>
      )}
      <button type="submit" disabled={isResolving} className="btn btn-primary w-full">
        {isResolving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Resolving…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {outcome === 'false_positive' ? 'Mark as false positive' : 'Mark as resolved'}
          </>
        )}
      </button>
    </form>
  );
}
