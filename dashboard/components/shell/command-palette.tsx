'use client';

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CornerDownLeft,
  Keyboard,
  Link2,
  Loader2,
  Monitor,
  Moon,
  Rows3,
  Search,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { MIN_SEARCH_LENGTH, type SearchResult } from '@/lib/api';
import { rankCommands } from '@/lib/command-rank';
import { useDebounced, useSearch } from '@/lib/hooks';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { NAV_ITEMS } from '@/lib/nav';
import { useModal } from '@/lib/use-modal';
import { useDensity, useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';

interface Command {
  id: string;
  title: string;
  group: 'Jump to' | 'Actions' | 'Records';
  icon: LucideIcon;
  keywords?: readonly string[];
  hint?: string;
  subtitle?: string;
  run: () => void;
}

const KIND_ICON: Record<SearchResult['kind'], LucideIcon> = {
  transaction: ArrowLeftRight,
  discrepancy: AlertTriangle,
  pair: Link2,
};

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  transaction: 'Transaction',
  discrepancy: 'Discrepancy',
  pair: 'Match',
};

export function resultHref(r: SearchResult): string {
  const id = encodeURIComponent(r.id);
  if (r.kind === 'transaction') return `/transactions?id=${id}`;
  if (r.kind === 'pair') return `/matches?id=${id}`;
  return `/inbox?status=all&id=${id}`;
}

function PaletteBody({ onClose, onOpenShortcuts }: { onClose: () => void; onOpenShortcuts: () => void }) {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const { density, toggleDensity } = useDensity();
  const ref = useModal<HTMLDivElement>(true, onClose);
  const reduce = useReducedMotion();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const term = useDebounced(query.trim(), 180);
  const searching = term.length >= MIN_SEARCH_LENGTH;
  const search = useSearch(searching ? term : '');

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const nav: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav:${item.href}`,
      title: item.label,
      group: 'Jump to',
      icon: item.icon,
      keywords: item.keywords,
      hint: `G ${item.key.toUpperCase()}`,
      run: go(item.href),
    }));
    const theme: Command[] = (
      [
        ['dark', 'Use dark theme', Moon],
        ['light', 'Use light theme', Sun],
        ['system', 'Use system theme', Monitor],
      ] as const
    )
      .filter(([value]) => value !== preference)
      .map(([value, title, icon]) => ({
        id: `theme:${value}`,
        title,
        group: 'Actions' as const,
        icon,
        keywords: ['theme', 'appearance', 'mode', 'toggle'],
        run: () => {
          setPreference(value);
          onClose();
        },
      }));
    const actions: Command[] = [
      { id: 'inbox:critical', title: 'Inbox: open critical discrepancies', group: 'Actions', icon: AlertTriangle, keywords: ['severity', 'urgent', 'triage'], run: go('/inbox?severity=critical') },
      { id: 'inbox:high', title: 'Inbox: open high-severity discrepancies', group: 'Actions', icon: AlertTriangle, keywords: ['severity', 'triage'], run: go('/inbox?severity=high') },
      { id: 'tx:unmatched', title: 'Transactions: unmatched', group: 'Actions', icon: ArrowLeftRight, keywords: ['silver', 'missing'], run: go('/transactions?match_status=unmatched') },
      { id: 'pairs:discrepancy', title: 'Matches: pairs with a discrepancy', group: 'Actions', icon: Link2, keywords: ['mismatch', 'review'], run: go('/matches?status=discrepancy') },
      ...theme,
      {
        id: 'density',
        title: density === 'compact' ? 'Use comfortable rows' : 'Use compact rows',
        group: 'Actions',
        icon: Rows3,
        keywords: ['density', 'spacing', 'table'],
        run: () => {
          toggleDensity();
          onClose();
        },
      },
      {
        id: 'shortcuts',
        title: 'Show keyboard shortcuts',
        group: 'Actions',
        icon: Keyboard,
        keywords: ['help', 'keys', 'hotkeys'],
        hint: '?',
        run: () => {
          onClose();
          onOpenShortcuts();
        },
      },
    ];
    return [...nav, ...actions];
  }, [router, onClose, preference, setPreference, density, toggleDensity, onOpenShortcuts]);

  const ranked = useMemo(() => rankCommands(query, commands, query.trim() ? 8 : Infinity), [query, commands]);
  const records = useMemo<Command[]>(
    () =>
      searching && search.data
        ? search.data.results.map((r) => ({
            id: `rec:${r.kind}:${r.id}`,
            title: r.title,
            subtitle: `${KIND_LABEL[r.kind]} · ${r.subtitle}`,
            group: 'Records' as const,
            icon: KIND_ICON[r.kind],
            run: () => {
              onClose();
              router.push(resultHref(r));
            },
          }))
        : [],
    [searching, search.data, onClose, router],
  );

  const items = useMemo(() => [...ranked, ...records], [ranked, records]);
  const groups = useMemo(() => {
    const order: Command['group'][] = ['Jump to', 'Actions', 'Records'];
    return order
      .map((g) => ({ group: g, items: items.filter((c) => c.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  const activeIndex = Math.min(active, Math.max(0, items.length - 1));
  const activeItem = items[activeIndex];
  const optionId = (c: Command) => `${listId}-${c.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const activeOptionId = activeItem ? optionId(activeItem) : undefined;

  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setActive((i) => (items.length ? (Math.min(i, items.length - 1) + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setActive((i) => (items.length ? (Math.min(i, items.length - 1) - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, items.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activeItem?.run();
    }
  }

  const status = !searching
    ? query.trim().length > 0 && query.trim().length < MIN_SEARCH_LENGTH
      ? `Type ${MIN_SEARCH_LENGTH} characters to search records`
      : null
    : search.isLoading
      ? 'Searching records'
      : search.error
        ? `Record search failed: ${search.error.detail}`
        : search.data && search.data.results.length === 0
          ? `No records match “${term}”`
          : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <motion.div
        className="scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="overlay relative flex max-h-[min(560px,76vh)] w-full max-w-[620px] flex-col overflow-hidden outline-none"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -8 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985, transition: { duration: DURATION.fast } }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {searching && search.isLoading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />
          )}
          <input
            data-autofocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-label="Search pages, actions and records"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions, references or IDs"
            className="h-[52px] flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map(({ group, items: groupItems }) => (
            <div key={group} role="group" aria-label={group} className="pb-1">
              <div aria-hidden="true" className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">
                {group}
              </div>
              {groupItems.map((c) => {
                const index = items.indexOf(c);
                const selected = index === activeIndex;
                const Icon = c.icon;
                return (
                  <div
                    key={c.id}
                    id={optionId(c)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(index)}
                    onClick={() => c.run()}
                    className={cn(
                      'flex min-h-10 cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2 text-[13.5px]',
                      selected ? 'bg-accent-soft text-fg' : 'text-fg-muted',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-fg' : 'text-fg-subtle')} strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate', c.group === 'Records' && 'font-mono text-[13px]')}>{c.title}</span>
                      {c.subtitle && <span className="t-caption block truncate">{c.subtitle}</span>}
                    </span>
                    {c.hint && <span className="text-[12px] text-fg-subtle">{c.hint}</span>}
                    {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && !status && <p className="px-3 py-8 text-center text-[13px] text-fg-subtle">Nothing matches “{query}”.</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-fg-subtle">
          <p role="status" aria-live="polite" className="min-w-0 truncate">
            {status ?? `${items.length} result${items.length === 1 ? '' : 's'}`}
          </p>
          <span className="flex shrink-0 items-center gap-3 max-sm:hidden">
            <span className="inline-flex items-center gap-1">
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd> move
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="kbd">↵</kbd> open
            </span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}

export function CommandPalette({ open, onClose, onOpenShortcuts }: { open: boolean; onClose: () => void; onOpenShortcuts: () => void }) {
  return <AnimatePresence>{open && <PaletteBody key="palette" onClose={onClose} onOpenShortcuts={onOpenShortcuts} />}</AnimatePresence>;
}
