'use client';

import { forwardRef, useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Check, CircleSlash, Loader2 } from 'lucide-react';
import { AuditTrail } from '@/components/audit-trail';
import { SeverityBadge, SeverityPip, StatusBadge } from '@/components/badges';
import { CopyButton } from '@/components/copy-button';
import { Evidence } from '@/components/evidence';
import { PspName } from '@/components/psp-logos';
import { Segmented } from '@/components/segmented';
import { ACTIONABLE_STATUSES, MIN_RESOLUTION_NOTE, type Discrepancy, type DiscrepancyEvent, type ResolveOutcome } from '@/lib/api';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { formatNgn } from '@/lib/money';
import { formatAge, formatDateTime, humanize, shortId } from '@/lib/utils';
import { useModKey } from '@/components/shell/mod-key';

export interface DetailItem extends Discrepancy {
  /** True while a resolution for this row is being saved. */
  saving?: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-5 sm:px-8">
      <h3 className="mb-3.5 text-[13px] font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

export const DiscrepancyDetail = forwardRef<
  HTMLHeadingElement,
  {
    item: DetailItem;
    now: number | null;
    composer: ResolveOutcome | null;
    onComposer: (outcome: ResolveOutcome | null) => void;
    onResolve: (note: string, outcome: ResolveOutcome) => void;
    pendingEvent: DiscrepancyEvent | null;
    showHeading?: boolean;
  }
>(function DiscrepancyDetail({ item: d, now, composer, onComposer, onResolve, pendingEvent, showHeading = true }, headingRef) {
  const actionable = (ACTIONABLE_STATUSES as string[]).includes(d.status) && !d.saving;

  return (
    <article className="flex min-h-full flex-col" aria-label={`${humanize(d.discrepancy_type)} discrepancy`}>
      <div className="flex-1">
        <header className="px-6 pb-5 pt-6 sm:px-8 sm:pt-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {showHeading && (
                <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.015em] text-fg outline-none">
                  <SeverityPip severity={d.severity} className="h-2.5 w-2.5" />
                  {humanize(d.discrepancy_type)}
                </h2>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={d.severity} />
                <StatusBadge status={d.status} />
                {d.saving && (
                  <span className="badge badge-outline">
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden="true" /> Saving
                  </span>
                )}
              </div>
            </div>
            <Link href={`/transactions?id=${d.transaction_id}`} className="btn btn-secondary btn-sm shrink-0">
              Transaction <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3">
              <dt className="t-caption">Estimated exposure</dt>
              <dd className="t-metric mt-1.5 text-[28px]">{formatNgn(d.estimated_exposure_ngn)}</dd>
            </div>
            <div>
              <dt className="t-caption">Transaction amount</dt>
              <dd className="num mt-1.5 text-[14px] font-medium text-fg">{formatNgn(d.amount_ngn)}</dd>
            </div>
            <div>
              <dt className="t-caption">PSP</dt>
              <dd className="mt-1.5 text-[14px] font-medium text-fg">
                <PspName name={d.psp_name} />
              </dd>
            </div>
            <div>
              <dt className="t-caption">Raised</dt>
              <dd className="num mt-1.5 text-[14px] font-medium text-fg" title={formatDateTime(d.detected_at)}>
                {now === null ? formatDateTime(d.detected_at) : `${formatAge(d.detected_at, now)} ago`}
              </dd>
            </div>
          </dl>
        </header>

        <Section title="Evidence">
          <Evidence type={d.discrepancy_type} evidence={d.evidence} />
        </Section>

        <Section title="Details">
          <dl className="dl-rows">
            <div>
              <dt>PSP reference</dt>
              <dd className="flex items-center gap-1.5">
                <span className="t-mono break-all">{d.psp_transaction_ref ?? '—'}</span>
                {d.psp_transaction_ref && <CopyButton value={d.psp_transaction_ref} label="PSP reference" />}
              </dd>
            </div>
            <div>
              <dt>Discrepancy ID</dt>
              <dd className="flex items-center gap-1.5">
                <span className="t-mono" title={d.id}>
                  {shortId(d.id)}
                </span>
                <CopyButton value={d.id} label="discrepancy ID" />
              </dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>
                <Link href={`/transactions?id=${d.transaction_id}`} className="t-link t-mono" title={d.transaction_id}>
                  {shortId(d.transaction_id)}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Raised at</dt>
              <dd className="num">{formatDateTime(d.detected_at)}</dd>
            </div>
            {d.resolved_at && (
              <div>
                <dt>Closed</dt>
                <dd className="num">
                  {formatDateTime(d.resolved_at)}
                  {d.resolved_by ? ` by ${d.resolved_by}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </Section>

        <Section title="Audit trail">
          <AuditTrail id={d.id} pending={pendingEvent} />
        </Section>
      </div>

      {actionable && <Composer key={d.id} outcome={composer} onOutcome={onComposer} onSubmit={onResolve} />}
    </article>
  );
});

function Composer({
  outcome,
  onOutcome,
  onSubmit,
}: {
  outcome: ResolveOutcome | null;
  onOutcome: (o: ResolveOutcome | null) => void;
  onSubmit: (note: string, outcome: ResolveOutcome) => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  const mod = useModKey();
  const noteId = useId();
  const hintId = useId();
  const errorId = useId();
  const trimmed = note.trim();
  const tooShort = trimmed.length < MIN_RESOLUTION_NOTE;
  const showError = touched && tooShort;

  // The form mounts after the action buttons animate out, so focus the note on mount.
  const attachTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    el?.focus();
  }, []);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (tooShort || !outcome) {
      textareaRef.current?.focus();
      return;
    }
    onSubmit(trimmed, outcome);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onOutcome(null);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="sticky bottom-0 z-[2] border-t border-line bg-panel shadow-[0_-8px_16px_-12px_rgb(15_15_18/0.12)]">
      <AnimatePresence initial={false} mode="wait">
        {outcome === null ? (
          <motion.div
            key="actions"
            className="flex flex-wrap items-center gap-2 px-6 py-3.5 sm:px-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast }}
          >
            <button type="button" className="btn btn-primary" onClick={() => onOutcome('resolved')} aria-keyshortcuts="E">
              <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Resolve
              <kbd className="kbd ml-1 h-[18px] border-transparent bg-on-ink/15 text-[11px] text-on-ink">E</kbd>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onOutcome('false_positive')} aria-keyshortcuts="Shift+E">
              <CircleSlash className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              False positive
              <kbd className="kbd ml-1 h-[18px] text-[11px]">⇧E</kbd>
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={submit}
            noValidate
            className="space-y-3 px-6 pb-5 pt-4 sm:px-8"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            aria-label="Close this discrepancy"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Outcome"
                value={outcome}
                onChange={(o) => onOutcome(o)}
                options={[
                  { value: 'resolved', label: 'Resolved' },
                  { value: 'false_positive', label: 'False positive' },
                ]}
              />
              <span className="t-caption">Written to the audit trail</span>
            </div>
            <div className="field">
              <label htmlFor={noteId}>Resolution note</label>
              <textarea
                ref={attachTextarea}
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => note && setTouched(true)}
                onKeyDown={onKeyDown}
                rows={2}
                aria-invalid={showError}
                aria-describedby={`${hintId}${showError ? ` ${errorId}` : ''}`}
                placeholder={outcome === 'resolved' ? 'What was found and how it was settled, e.g. the PSP payout reference' : 'Why this is not a real discrepancy'}
                className="textarea !min-h-[68px]"
              />
              <div className="flex items-center justify-between gap-3">
                <p id={hintId} className="t-caption num">
                  At least {MIN_RESOLUTION_NOTE} characters ({trimmed.length})
                </p>
                {showError && (
                  <p id={errorId} className="text-[12.5px] font-medium text-critical-text">
                    Add a little more detail.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn btn-primary">
                {outcome === 'resolved' ? 'Mark resolved' : 'Mark false positive'}
                <kbd className="kbd ml-1 h-[18px] border-transparent bg-on-ink/15 text-[11px] text-on-ink">{mod === '⌘' ? '⌘↵' : 'Ctrl ↵'}</kbd>
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onOutcome(null)}>
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
