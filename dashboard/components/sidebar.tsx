'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  LayoutDashboard,
  Server,
  X,
} from 'lucide-react';
import { ReadinessIndicator } from '@/components/readiness-indicator';
import { useModal } from '@/lib/use-modal';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { label: 'Overview', href: '/', icon: LayoutDashboard },
  { label: 'Discrepancies', href: '/discrepancies', icon: AlertTriangle },
  { label: 'PSP health', href: '/psp-health', icon: Activity },
  { label: 'Daily return', href: '/reports', icon: FileBarChart, note: 'Experimental' },
  { label: 'System', href: '/system', icon: Server },
] as const;

type NavItemConfig = (typeof NAV_ITEMS)[number];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

// ── Sidebar ───────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({ collapsed, onToggle, onNavigate, className }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[var(--color-surface-200)] bg-[var(--color-surface-0)]',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-[64px]' : 'w-[232px]',
        className,
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex h-[56px] shrink-0 items-center border-b border-[var(--color-surface-200)]',
          collapsed ? 'justify-center px-3' : 'px-4',
        )}
      >
        <Link
          href="/"
          onClick={onNavigate}
          className="focus-ring -ml-1 flex items-center gap-2.5 rounded-md p-1"
          aria-label="MMR overview"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-900)]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 13V3L5.5 8.5L8 5L10.5 8.5L14 3V13"
                stroke="var(--color-surface-0)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-none tracking-tight text-[var(--color-surface-900)]">
                MMR Engine
              </span>
              <span className="mt-1 block truncate text-[12px] leading-none text-[var(--color-surface-500)]">
                Reconciliation console
              </span>
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <NavItem item={item} active={isActive(pathname, item.href)} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="shrink-0 space-y-1 border-t border-[var(--color-surface-200)] p-2">
        <ReadinessIndicator collapsed={collapsed} />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'focus-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium',
              'text-[var(--color-surface-500)] transition-colors hover:bg-[var(--color-surface-100)] hover:text-[var(--color-surface-800)]',
              collapsed ? 'justify-center px-0' : 'justify-between',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <>
                <span>Collapse</span>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function NavItem({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItemConfig;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const note = 'note' in item ? item.note : undefined;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'focus-ring relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'bg-[var(--color-surface-100)] text-[var(--color-surface-900)]'
          : 'text-[var(--color-surface-600)] hover:bg-[var(--color-surface-100)] hover:text-[var(--color-surface-900)]',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-r-full bg-[var(--color-surface-900)]"
        />
      )}
      <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {note && <span className="nav-note">{note}</span>}
        </>
      )}
    </Link>
  );
}

// ── Mobile navigation (modal) ─────────────────────────────────────────

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useModal<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="animate-slide-in-left absolute inset-y-0 left-0 flex outline-none"
      >
        <Sidebar collapsed={false} onNavigate={onClose} className="shadow-xl" />
        <button
          type="button"
          onClick={onClose}
          className="focus-ring absolute right-2 top-3 flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-surface-600)] hover:bg-[var(--color-surface-100)]"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
