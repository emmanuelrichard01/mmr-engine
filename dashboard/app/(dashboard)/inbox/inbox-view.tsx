'use client';

import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, Inbox as InboxIcon, Keyboard, RotateCw, X } from 'lucide-react';
import { SeverityLabel, SeverityPip, STATUS_LABEL, StatusBadge } from '@/components/badges';
import { Dialog } from '@/components/dialog';
import { EmptyState } from '@/components/empty-state';
import { rowReveal } from '@/components/motion-primitives';
import { ErrorNotice, PanelError } from '@/components/notices';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PspIcon } from '@/components/psp-logos';
import { Segmented } from '@/components/segmented';
import { Sheet } from '@/components/sheet';
import { TabList } from '@/components/tabs';
import { useToast } from '@/components/toaster';
import {
  ACTIONABLE_STATUSES,
  MAX_BULK_RESOLVE,
  MIN_RESOLUTION_NOTE,
  PSPS,
  SEVERITIES,
  bulkResolveDiscrepancies,
  resolveDiscrepancy,
  toApiError,
  type DiscrepancyEvent,
  type DiscrepancyStatus,
  type ResolveOutcome,
} from '@/lib/api';
import { invalidateQueries, useDiscrepancies, useMediaQuery, useNow } from '@/lib/hooks';
import { initialListNav, listNavReducer } from '@/lib/list-nav';
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/lib/motion';
import { formatNgn } from '@/lib/money';
import { param } from '@/lib/url-state';
import { useHotkeys } from '@/lib/use-hotkeys';
import { useUrlState } from '@/lib/use-url-state';
import { cn, formatAge, humanize, pspDisplayName } from '@/lib/utils';
import { DiscrepancyDetail, type DetailItem } from './discrepancy-detail';
import { InboxRowsSkeleton } from './inbox-skeleton';

const PAGE_SIZE = 50;
const STATUS_TABS = ['open', 'under_review', 'escalated', 'resolved', 'false_positive', 'all'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const SCHEMA = {
  status: param.enum(STATUS_TABS, 'open'),
  severity: param.enum(SEVERITIES),
  psp: param.enum(PSPS),
  offset: param.int(0, { max: 1_000_000 }),
  id: param.id(),
};
const URL_OPTIONS = { resetKey: 'offset', resetOnChange: ['status', 'severity', 'psp'] } as const;

interface Override {
  status: ResolveOutcome;
  note: string;
  at: string;
  saving: boolean;
}

const OUTCOME_VERB: Record<ResolveOutcome, string> = { resolved: 'Resolved', false_positive: 'Marked false positive' };

function tabLabel(t: StatusTab) {
  return t === 'all' ? 'All' : STATUS_LABEL[t as DiscrepancyStatus];
}

// ── Row ──────────────────────────────────────────────────────────────────────

const Row = memo(function Row({
  d,
  index,
  active,
  checked,
  open,
  now,
  animateIn,
  onActivate,
  onToggle,
  buttonRef,
}: {
  d: DetailItem;
  index: number;
  active: boolean;
  checked: boolean;
  open: boolean;
  now: number | null;
  animateIn: boolean;
  onActivate: (id: string) => void;
  onToggle: (id: string) => void;
  buttonRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const reduce = useReducedMotion();
  const label = `${humanize(d.discrepancy_type)}, ${d.psp_transaction_ref ?? d.transaction_id}`;
  return (
    <motion.li
      layout={reduce ? false : 'position'}
      {...(animateIn ? rowReveal(index, reduce) : {})}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: DURATION.base, ease: EASE_OUT } }}
      data-active={active || undefined}
      className={cn(
        'relative border-b border-line transition-colors',
        open ? 'bg-accent-soft' : active ? 'bg-panel-hover' : 'hover:bg-panel-hover',
      )}
    >
      {open && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-accent" />}
      <div className="flex h-[var(--row-h-lg)] items-center gap-3 px-4">
        <input
          type="checkbox"
          className="check relative z-[1]"
          checked={checked}
          onChange={() => onToggle(d.id)}
          tabIndex={active ? 0 : -1}
          aria-label={`Select ${label}`}
        />
        <button
          ref={(el) => buttonRef(d.id, el)}
          type="button"
          tabIndex={active ? 0 : -1}
          onClick={() => onActivate(d.id)}
          onFocus={() => onActivate(d.id)}
          aria-current={open ? 'true' : undefined}
          className="row-button flex min-w-0 flex-1 items-center gap-3"
        >
          <SeverityPip severity={d.severity} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-medium text-fg">{humanize(d.discrepancy_type)}</span>
              {d.status !== 'open' && <StatusBadge status={d.status} className="h-[18px] px-1.5 text-[11.5px]" />}
              {d.saving && <span className="sr-only">saving</span>}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
              <SeverityLabel severity={d.severity} />
              <PspIcon name={d.psp_name} className="ml-0.5 h-3 w-3 shrink-0" />
              <span className="sr-only">{pspDisplayName(d.psp_name)}</span>
              <span className="t-mono truncate">{d.psp_transaction_ref ?? d.transaction_id}</span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="num block text-[13px] font-medium text-fg">{formatNgn(d.estimated_exposure_ngn)}</span>
            <span className="num t-caption block">{formatAge(d.detected_at, now)}</span>
          </span>
        </button>
      </div>
    </motion.li>
  );
});

// ── View ─────────────────────────────────────────────────────────────────────

export function InboxView() {
  const [params, setParams] = useUrlState(SCHEMA, URL_OPTIONS);
  const { toast } = useToast();
  const now = useNow();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const reduce = useReducedMotion();
  const tabsId = useId();

  const filters = useMemo(
    () => ({ status: params.status, severity: params.severity, psp_name: params.psp, limit: PAGE_SIZE, offset: params.offset }),
    [params.status, params.severity, params.psp, params.offset],
  );
  const query = useDiscrepancies(filters, { refreshMs: 60_000 });
  const { data, error, isLoading, isRefreshing, refetch, updatedAt } = query;

  // Optimistic state: resolutions the viewer made in this session, applied over the API rows.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const rows = useMemo<DetailItem[]>(() => {
    const list = data?.discrepancies ?? [];
    return list
      .map((d): DetailItem => {
        const o = overrides[d.id];
        if (!o || !(ACTIONABLE_STATUSES as string[]).includes(d.status)) return d;
        return { ...d, status: o.status, resolved_at: o.at, resolution_note: o.note, saving: o.saving };
      })
      .filter((d) => params.status === 'all' || d.status === params.status);
  }, [data, overrides, params.status]);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const [nav, dispatch] = useReducer(listNavReducer, initialListNav);

  // Keep the reducer in step with the visible rows (refetch, optimistic removal,
  // rollback). The reducer ignores an identical list.
  useEffect(() => {
    dispatch({ type: 'sync', ids });
  }, [ids]);

  // URL → cursor, for deep links and palette jumps: acts only when the URL's id
  // changed from outside, never in response to the cursor writing it.
  const urlIdSeen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    if (params.id !== urlIdSeen.current) {
      if (params.id && ids.includes(params.id)) {
        urlIdSeen.current = params.id;
        dispatch({ type: 'set', id: params.id });
        return;
      }
      if (!params.id) urlIdSeen.current = undefined;
    }
    if (!params.id && nav.cursor === null && ids.length > 0 && isDesktop) dispatch({ type: 'set', id: ids[0] });
  }, [params.id, ids, data, isDesktop, nav.cursor]);

  // Cursor → URL, so the open item is always shareable. Acts only when the cursor moved.
  const cursorSeen = useRef<string | null>(null);
  useEffect(() => {
    if (nav.cursor === cursorSeen.current) return;
    cursorSeen.current = nav.cursor;
    if (nav.cursor && nav.cursor !== params.id) {
      urlIdSeen.current = nav.cursor;
      setParams({ id: nav.cursor });
    } else if (!nav.cursor && params.id && overrides[params.id]) {
      urlIdSeen.current = undefined;
      setParams({ id: undefined });
    }
  }, [nav.cursor, params.id, overrides, setParams]);

  const selected = nav.cursor ? (rows.find((r) => r.id === nav.cursor) ?? null) : null;
  const missingDeepLink = !!params.id && !!data && !ids.includes(params.id) && !overrides[params.id];

  // ── Focus management ──
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const registerButton = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(id, el);
    else buttons.current.delete(id);
  }, []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composer, setComposer] = useState<ResolveOutcome | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<ResolveOutcome | null>(null);

  const [lastCursor, setLastCursor] = useState(nav.cursor);
  if (lastCursor !== nav.cursor) {
    setLastCursor(nav.cursor);
    setComposer(null);
  }

  const focusCursor = useCallback((id: string | null) => {
    if (!id) return;
    requestAnimationFrame(() => buttons.current.get(id)?.focus({ preventScroll: false }));
  }, []);

  const move = useCallback(
    (delta: number) => {
      const index = nav.cursor ? ids.indexOf(nav.cursor) : -1;
      const nextIndex = index === -1 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, index + delta));
      dispatch({ type: 'move', delta });
      focusCursor(ids[nextIndex] ?? null);
    },
    [nav.cursor, ids, focusCursor],
  );

  const activate = useCallback((id: string) => dispatch({ type: 'set', id }), []);
  const openRow = useCallback(
    (id: string) => {
      dispatch({ type: 'set', id });
      if (!isDesktop) setSheetOpen(true);
    },
    [isDesktop],
  );
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);

  // ── Resolve (optimistic) ──
  const resolveIds = useCallback(
    async (targets: string[], note: string, outcome: ResolveOutcome) => {
      if (targets.length === 0) return;
      const at = new Date().toISOString();
      setOverrides((o) => ({ ...o, ...Object.fromEntries(targets.map((id) => [id, { status: outcome, note, at, saving: true }])) }));
      dispatch({ type: 'clear' });
      setComposer(null);
      const label = (id: string) => rows.find((r) => r.id === id)?.psp_transaction_ref ?? 'discrepancy';
      try {
        let resolved: string[];
        let skipped: { id: string; reason: string }[] = [];
        if (targets.length === 1) {
          await resolveDiscrepancy(targets[0], note, outcome);
          resolved = targets;
        } else {
          const res = await bulkResolveDiscrepancies(targets, note, outcome);
          resolved = res.resolved;
          skipped = res.skipped;
        }
        setOverrides((o) => {
          const next = { ...o };
          for (const id of resolved) if (next[id]) next[id] = { ...next[id], saving: false };
          for (const s of skipped) delete next[s.id];
          return next;
        });
        toast({
          tone: 'success',
          title: resolved.length === 1 ? `${OUTCOME_VERB[outcome]}: ${label(resolved[0])}` : `${OUTCOME_VERB[outcome]}: ${resolved.length} discrepancies`,
          detail: skipped.length ? `${skipped.length} skipped (${[...new Set(skipped.map((s) => humanize(s.reason).toLowerCase()))].join(', ')}).` : 'Recorded in the audit trail.',
        });
      } catch (err) {
        setOverrides((o) => {
          const next = { ...o };
          for (const id of targets) delete next[id];
          return next;
        });
        const e = toApiError(err);
        toast({
          tone: 'error',
          title: targets.length === 1 ? `Couldn’t close ${label(targets[0])}` : `Couldn’t close ${targets.length} discrepancies`,
          detail: `${e.detail}${e.status ? ` (HTTP ${e.status})` : ''}. Nothing was changed.`,
        });
      } finally {
        invalidateQueries('discrepancies:', 'exposure:', 'summary', 'psp-health', 'trend:', 'transaction', 'pair');
        for (const id of targets) invalidateQueries(`discrepancy-events:${id}`);
      }
    },
    [rows, toast],
  );

  const pendingEvent: DiscrepancyEvent | null = selected?.saving
    ? {
        action: selected.status === 'false_positive' ? 'marked_false_positive' : 'resolved',
        from_status: null,
        to_status: selected.status,
        actor: null,
        note: selected.resolution_note ?? null,
        occurred_at: selected.resolved_at ?? new Date().toISOString(),
      }
    : null;

  const startComposer = useCallback(
    (outcome: ResolveOutcome) => {
      if (!selected || !(ACTIONABLE_STATUSES as string[]).includes(selected.status) || selected.saving) return;
      if (nav.selected.length > 1) {
        setBulkOutcome(outcome);
        return;
      }
      if (!isDesktop) setSheetOpen(true);
      setComposer(outcome);
    },
    [selected, nav.selected.length, isDesktop],
  );

  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    enter: () => {
      if (!nav.cursor) return;
      if (isDesktop) headingRef.current?.focus();
      else setSheetOpen(true);
    },
    x: () => dispatch({ type: 'toggle' }),
    'shift+x': () => dispatch({ type: 'toggleAll' }),
    e: () => startComposer('resolved'),
    'shift+e': () => startComposer('false_positive'),
    escape: () => {
      if (nav.selected.length) dispatch({ type: 'clear' });
      else if (composer) setComposer(null);
    },
  });

  const actionableSelection = nav.selected.filter((id) => {
    const r = rows.find((x) => x.id === id);
    return r && (ACTIONABLE_STATUSES as string[]).includes(r.status) && !r.saving;
  });
  const allChecked = ids.length > 0 && nav.selected.length === ids.length;
  const someChecked = nav.selected.length > 0 && !allChecked;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);

  // Reveal rows only for the first load of a filter, not on refetches or optimistic changes.
  const filterKey = `${params.status}|${params.severity}|${params.psp}|${params.offset}`;
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const animateRows = !!data && revealKey !== filterKey;
  useEffect(() => {
    if (!data) return;
    const id = window.setTimeout(() => setRevealKey(filterKey), 600);
    return () => window.clearTimeout(id);
  }, [data, filterKey]);

  const activeFilters = (params.severity ? 1 : 0) + (params.psp ? 1 : 0);
  const detail = selected ? (
    <DiscrepancyDetail
      ref={headingRef}
      item={selected}
      now={now}
      composer={composer}
      onComposer={setComposer}
      onResolve={(note, outcome) => resolveIds([selected.id], note, outcome)}
      pendingEvent={pendingEvent}
      showHeading={isDesktop}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-[var(--page-x)] pt-7">
        <PageHeader
          title="Inbox"
          description={
            <>
              What the engine could not reconcile.<span className="max-lg:hidden"> J and K move, X selects, E resolves.</span>
            </>
          }
          actions={
            <>
              <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
                <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
                {isRefreshing ? 'Refreshing' : 'Refresh'}
              </button>
            </>
          }
        />
        <TabList
          label="Status"
          idBase={tabsId}
          className="mt-5 border-b-0"
          tabs={STATUS_TABS.map((t) => ({ value: t, label: tabLabel(t) }))}
          value={params.status}
          onChange={(status) => setParams({ status, id: undefined })}
        />
      </div>

      <div className="flex min-h-0 flex-1" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${params.status}`}>
        {/* List */}
        <section aria-label="Discrepancies" className="flex w-full min-w-0 flex-col border-line lg:w-[460px] lg:shrink-0 lg:border-r xl:w-[500px]">
          <div className="flex min-h-[52px] flex-wrap items-center gap-2 border-b border-line px-4 py-2">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="check"
              checked={allChecked}
              onChange={() => dispatch({ type: 'toggleAll' })}
              disabled={ids.length === 0}
              aria-label="Select all on this page"
            />
            <label className="sr-only" htmlFor="inbox-severity">
              Severity
            </label>
            <select
              id="inbox-severity"
              className="select select-sm w-auto"
              data-active={!!params.severity}
              value={params.severity ?? ''}
              onChange={(e) => setParams({ severity: (e.target.value || undefined) as typeof params.severity, id: undefined })}
            >
              <option value="">Any severity</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="inbox-psp">
              PSP
            </label>
            <select
              id="inbox-psp"
              className="select select-sm w-auto"
              data-active={!!params.psp}
              value={params.psp ?? ''}
              onChange={(e) => setParams({ psp: (e.target.value || undefined) as typeof params.psp, id: undefined })}
            >
              <option value="">Any PSP</option>
              {PSPS.map((p) => (
                <option key={p} value={p}>
                  {pspDisplayName(p)}
                </option>
              ))}
            </select>
            {activeFilters > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({ severity: undefined, psp: undefined, id: undefined })}>
                <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                Clear
              </button>
            )}
          </div>

          {missingDeepLink && (
            <div role="status" className="notice m-3 items-center">
              <p className="flex-1">That discrepancy isn’t in this view. It may have another status or be on another page.</p>
              {params.status !== 'all' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ status: 'all' })}>
                  Show all
                </button>
              )}
              <button type="button" className="icon-btn h-7 w-7" onClick={() => setParams({ id: undefined })} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          )}

          {error && data && (
            <ErrorNotice error={error} what="discrepancies" onRetry={refetch} retrying={isRefreshing} staleSince={updatedAt} className="m-3" />
          )}

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <>
                <span role="status" className="sr-only">
                  Loading discrepancies
                </span>
                <InboxRowsSkeleton />
              </>
            ) : error && !data ? (
              <PanelError error={error} what="discrepancies" onRetry={refetch} retrying={isRefreshing} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={params.status === 'open' && !activeFilters ? <CheckCircle2 className="h-5 w-5" strokeWidth={1.5} /> : <InboxIcon className="h-5 w-5" strokeWidth={1.5} />}
                title={
                  params.status === 'open' && !activeFilters
                    ? 'Inbox zero'
                    : `No ${params.status === 'all' ? '' : `${tabLabel(params.status).toLowerCase()} `}discrepancies${activeFilters ? ' match these filters' : ''}`
                }
                description={
                  params.status === 'open' && !activeFilters
                    ? 'Every discrepancy is triaged. New ones appear here when the matching flow raises them.'
                    : activeFilters
                      ? 'Try another severity or PSP, or clear the filters.'
                      : 'Nothing in this state right now.'
                }
                action={
                  activeFilters ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ severity: undefined, psp: undefined })}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <ul aria-label={`${tabLabel(params.status)} discrepancies${params.severity ? `, ${params.severity}` : ''}${params.psp ? `, ${pspDisplayName(params.psp)}` : ''}`}>
                <AnimatePresence initial={false}>
                  {rows.map((d, i) => (
                    <Row
                      key={d.id}
                      d={d}
                      index={i}
                      active={nav.cursor === d.id || (nav.cursor === null && i === 0)}
                      checked={nav.selected.includes(d.id)}
                      open={nav.cursor === d.id}
                      now={now}
                      animateIn={animateRows}
                      onActivate={sheetOpen ? activate : isDesktop ? activate : openRow}
                      onToggle={toggle}
                      buttonRef={registerButton}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          {/* Selection bar */}
          <AnimatePresence>
            {nav.selected.length > 0 && (
              <motion.div
                className="flex items-center gap-2 border-t border-line bg-panel px-4 py-2.5"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, transition: { duration: DURATION.fast } }}
                transition={SPRING_SNAPPY}
                role="region"
                aria-label="Bulk actions"
              >
                <p className="num flex-1 text-[13px] font-medium text-fg" aria-live="polite">
                  {nav.selected.length} selected
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={actionableSelection.length === 0 || actionableSelection.length > MAX_BULK_RESOLVE}
                  onClick={() => setBulkOutcome('resolved')}
                >
                  Resolve
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={actionableSelection.length === 0 || actionableSelection.length > MAX_BULK_RESOLVE}
                  onClick={() => setBulkOutcome('false_positive')}
                >
                  False positive
                </button>
                <button type="button" className="icon-btn h-7 w-7" onClick={() => dispatch({ type: 'clear' })} aria-label="Clear selection">
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {data && (rows.length > 0 || params.offset > 0) && (
            <div className="border-t border-line">
              <Pagination
                offset={params.offset}
                pageSize={PAGE_SIZE}
                shown={data.discrepancies.length}
                onChange={(offset) => setParams({ offset, id: undefined })}
                busy={isRefreshing}
                noun="discrepancies"
              />
            </div>
          )}
        </section>

        {/* Detail pane (wide screens) */}
        <section aria-label="Discrepancy detail" className="hidden min-w-0 flex-1 overflow-y-auto bg-panel lg:block">
          <AnimatePresence mode="wait" initial={false}>
            {detail ? (
              <motion.div
                key={selected?.id}
                className="h-full"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={{ duration: DURATION.base, ease: EASE_OUT }}
              >
                {detail}
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full items-center justify-center">
                {!isLoading && rows.length > 0 && (
                  <EmptyState
                    icon={<Keyboard className="h-5 w-5" strokeWidth={1.5} />}
                    title="Select a discrepancy"
                    description="Use J and K to move through the list, or click a row. The evidence, audit trail and resolve form open here."
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Detail sheet (narrow screens) */}
      <Sheet
        open={!isDesktop && sheetOpen && !!selected}
        onClose={() => {
          setSheetOpen(false);
          focusCursor(nav.cursor);
        }}
        title={selected ? humanize(selected.discrepancy_type) : ''}
        subtitle={selected?.psp_transaction_ref ?? undefined}
      >
        {detail}
      </Sheet>

      <BulkResolveDialog
        outcome={bulkOutcome}
        count={actionableSelection.length}
        skipped={nav.selected.length - actionableSelection.length}
        onOutcome={setBulkOutcome}
        onClose={() => setBulkOutcome(null)}
        onSubmit={(note, outcome) => {
          const targets = actionableSelection;
          setBulkOutcome(null);
          void resolveIds(targets, note, outcome);
        }}
      />
    </div>
  );
}

// ── Bulk resolve ─────────────────────────────────────────────────────────────

function BulkResolveDialog({
  outcome,
  count,
  skipped,
  onOutcome,
  onClose,
  onSubmit,
}: {
  outcome: ResolveOutcome | null;
  count: number;
  skipped: number;
  onOutcome: (o: ResolveOutcome) => void;
  onClose: () => void;
  onSubmit: (note: string, outcome: ResolveOutcome) => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = note.trim();
  const tooShort = trimmed.length < MIN_RESOLUTION_NOTE;
  const noteId = useId();
  const hintId = useId();

  const [wasOpen, setWasOpen] = useState(false);
  if (!!outcome !== wasOpen) {
    setWasOpen(!!outcome);
    if (outcome) {
      setNote('');
      setTouched(false);
    }
  }

  return (
    <Dialog
      open={outcome !== null}
      onClose={onClose}
      title={`Close ${count} discrepanc${count === 1 ? 'y' : 'ies'}`}
      description={`One note is recorded on each audit trail.${skipped ? ` ${skipped} selected item${skipped === 1 ? ' is' : 's are'} already closed and will be left as they are.` : ''}`}
    >
      <form
        noValidate
        className="space-y-4 px-6 pb-6 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!tooShort && outcome) onSubmit(trimmed, outcome);
        }}
      >
        <Segmented
          label="Outcome"
          hideLabel={false}
          value={outcome ?? 'resolved'}
          onChange={onOutcome}
          options={[
            { value: 'resolved', label: 'Resolved' },
            { value: 'false_positive', label: 'False positive' },
          ]}
        />
        <div className="field">
          <label htmlFor={noteId}>Resolution note</label>
          <textarea
            id={noteId}
            data-autofocus
            className="textarea"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={touched && tooShort}
            aria-describedby={hintId}
            placeholder="What was found, for all of them"
          />
          <p id={hintId} className={cn('t-caption num', touched && tooShort && 'font-medium text-critical-text')}>
            At least {MIN_RESOLUTION_NOTE} characters ({trimmed.length})
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {outcome === 'false_positive' ? `Mark ${count} false positive` : `Resolve ${count}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
