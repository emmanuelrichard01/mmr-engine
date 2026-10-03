'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { Keyboard, Monitor, Moon, Rows3, Rows4, Search, Sun } from 'lucide-react';
import { ReadinessIndicator } from '@/components/readiness-indicator';
import { Segmented } from '@/components/segmented';
import { useExposure } from '@/lib/hooks';
import { NAV_GROUPS, isActive, type NavItem } from '@/lib/nav';
import { SPRING_SNAPPY } from '@/lib/motion';
import { useDensity, useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import type { ThemePreference } from '@/lib/theme-script';
import { ModKeyHint } from './mod-key';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-ink', className)} aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M2 13V3L5.5 8.5L8 5L10.5 8.5L14 3V13" stroke="var(--color-on-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function OpenCount() {
  const { data } = useExposure();
  if (!data) return null;
  const n = data.by_psp_and_type.reduce((sum, e) => sum + e.open_count, 0);
  if (n === 0) return null;
  return (
    <span className="num ml-auto text-[12px] font-medium text-fg-subtle" title={`${n} unresolved: open, under review or escalated`}>
      {n.toLocaleString('en-NG')}
      <span className="sr-only"> unresolved</span>
    </span>
  );
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const reduce = useReducedMotion();
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className="nav-item isolate">
      {active && (
        <motion.span layoutId={reduce ? undefined : 'nav-active'} className="nav-active" transition={SPRING_SNAPPY} aria-hidden="true" />
      )}
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-fg' : 'text-fg-subtle')} strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {item.href === '/inbox' && <OpenCount />}
      {item.note && <span className="ml-auto text-[12px] font-medium text-fg-subtle">{item.note}</span>}
    </Link>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: React.ReactNode; title: string }[] = [
  { value: 'system', label: <ThemeIcon icon={Monitor} name="System" />, title: 'Follow system theme' },
  { value: 'light', label: <ThemeIcon icon={Sun} name="Light" />, title: 'Light theme' },
  { value: 'dark', label: <ThemeIcon icon={Moon} name="Dark" />, title: 'Dark theme' },
];

function ThemeIcon({ icon: Icon, name }: { icon: typeof Sun; name: string }) {
  return (
    <>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">{name}</span>
    </>
  );
}

export function Sidebar({
  onNavigate,
  onOpenPalette,
  onOpenShortcuts,
  className,
}: {
  onNavigate?: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { preference, setPreference } = useTheme();
  const { density, toggleDensity } = useDensity();

  return (
    <div className={cn('flex h-full w-[248px] shrink-0 flex-col bg-bg-subtle', className)}>
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Link href="/" onClick={onNavigate} className="-ml-1 flex items-center gap-2.5 rounded-[8px] p-1" aria-label="MMR overview">
          <BrandMark />
          <span className="min-w-0">
            <span className="block font-display text-[14px] font-semibold leading-none tracking-[-0.01em] text-fg [font-stretch:110%]">
              MMR
            </span>
            <span className="mt-1 block truncate text-[12px] leading-none text-fg-subtle">Reconciliation</span>
          </span>
        </Link>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-8 w-full items-center gap-2 rounded-[8px] bg-panel px-2.5 text-[13px] text-fg-subtle shadow-[0_0_0_1px_var(--color-line)] transition-colors hover:text-fg"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          <span className="flex-1 text-left">Search or jump to</span>
          <ModKeyHint letter="K" />
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label ?? gi} className={cn(gi > 0 && 'mt-5')}>
            {group.label && <p className="mb-1 px-2.5 text-[12px] font-medium text-fg-subtle">{group.label}</p>}
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-2 border-t border-line px-3 py-3">
        <ReadinessIndicator />
        <div className="flex items-center justify-between gap-2 px-1">
          <Segmented label="Theme" value={preference} options={THEME_OPTIONS} onChange={setPreference} />
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="icon-btn h-8 w-8"
              onClick={toggleDensity}
              aria-pressed={density === 'compact'}
              aria-label="Compact rows"
              title={density === 'compact' ? 'Compact rows (on)' : 'Compact rows (off)'}
            >
              {density === 'compact' ? (
                <Rows4 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Rows3 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="icon-btn h-8 w-8"
              onClick={onOpenShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              aria-keyshortcuts="Shift+?"
            >
              <Keyboard className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
