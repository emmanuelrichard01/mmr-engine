'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  AlertTriangle,
  Activity,
  FileBarChart,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Navigation config ─────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Overview',      href: '/',              icon: LayoutDashboard },
  { label: 'Discrepancies', href: '/discrepancies',  icon: AlertTriangle   },
  { label: 'PSP Health',    href: '/psp-health',     icon: Activity        },
  { label: 'Reports',       href: '/reports',        icon: FileBarChart    },
] as const;

const WORKSPACE_ITEMS = [
  { label: 'Investor Demo', href: '/investor', icon: TrendingUp, accent: true },
  { label: 'Settings',      href: '/settings', icon: Settings               },
] as const;

// ── Sidebar ───────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function Sidebar({ collapsed, onToggle, className }: SidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        'flex h-screen flex-col shrink-0 select-none',
        'border-r border-[var(--color-surface-200)]',
        'bg-[var(--color-surface-0)]',
        'transition-[width] duration-250 ease-out',
        collapsed ? 'w-[60px]' : 'w-[232px]',
        className
      )}
    >
      {/* ── Brand ────────────────────────────────────────────────── */}
      <div className={cn(
        'flex h-[56px] shrink-0 items-center border-b border-[var(--color-surface-200)]',
        collapsed ? 'px-3 justify-center' : 'px-4'
      )}>
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] p-1 -ml-1"
        >
          {/* Logo mark */}
          <div className="w-7 h-7 rounded-md bg-[var(--color-surface-900)] flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 13V3L5.5 8.5L8 5L10.5 8.5L14 3V13"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {!collapsed && (
            <div className="min-w-0 animate-fade-in">
              <p className="text-[13px] font-bold text-[var(--color-surface-900)] tracking-tight leading-none">
                MMR Engine
              </p>
              <p className="text-[11px] font-medium text-[var(--color-surface-400)] leading-none mt-1 truncate">
                by Emmanuel Richard
              </p>
            </div>
          )}
        </Link>
      </div>

      {/* ── Primary Navigation ────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">

        {/* Main items */}
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <NavItem
                key={item.href}
                item={item}
                active={active}
                collapsed={collapsed}
              />
            );
          })}
        </div>

        {/* Section divider */}
        <div className={cn(
          'pt-4 mt-3 border-t border-[var(--color-surface-200)]',
          'space-y-0.5'
        )}>
          {!collapsed && (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-surface-300)]">
              Workspace
            </p>
          )}
          {WORKSPACE_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <NavItem
                key={item.href}
                item={item}
                active={active}
                collapsed={collapsed}
              />
            );
          })}
        </div>
      </nav>

      {/* ── Bottom ───────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--color-surface-200)] p-2 space-y-0.5">
        {/* Logout */}
        <button
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('mmr-onboarded');
              window.location.href = '/onboarding';
            }
          }}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-3 py-2',
            'text-[12px] font-medium text-[var(--color-surface-500)]',
            'hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-600)]',
            'transition-colors duration-150 outline-none',
            'focus-visible:ring-2 focus-visible:ring-[var(--color-danger-500)]',
            collapsed && 'justify-center px-0'
          )}
          title={collapsed ? 'Logout' : undefined}
        >
          <LogOut className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          {!collapsed && <span>Logout</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2',
            'text-[12px] font-medium text-[var(--color-surface-400)]',
            'hover:bg-[var(--color-surface-100)] hover:text-[var(--color-surface-700)]',
            'transition-colors duration-150 outline-none',
            'focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]',
            collapsed ? 'justify-center px-0' : 'justify-between'
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-[14px] w-[14px]" strokeWidth={2} />
          ) : (
            <>
              <span>Collapse</span>
              <ChevronLeft className="h-[14px] w-[14px]" strokeWidth={2} />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

// ── NavItem ───────────────────────────────────────────────────────────

interface NavItemProps {
  item: { label: string; href: string; icon: typeof LayoutDashboard; accent?: boolean };
  active: boolean;
  collapsed: boolean;
}

function NavItem({ item, active, collapsed }: NavItemProps) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-3 py-[7px]',
        'text-[13px] font-medium transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]',
        // Active state — clear visual weight, works in dark + light mode
        active
          ? 'bg-[var(--color-surface-100)] text-[var(--color-surface-900)] font-semibold'
          : item.accent
          ? 'text-[var(--color-surface-700)] hover:bg-[var(--color-surface-100)] hover:text-[var(--color-surface-900)]'
          : 'text-[var(--color-surface-500)] hover:bg-[var(--color-surface-100)] hover:text-[var(--color-surface-800)]',
        collapsed && 'justify-center px-0 py-[9px]'
      )}
    >
      {/* Active indicator — Linear-style left accent strip */}
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-[var(--color-primary-500)] rounded-r-full" />
      )}

      <item.icon
        strokeWidth={active ? 2.5 : 2}
        className={cn(
          'h-[15px] w-[15px] shrink-0 transition-colors duration-150',
          active
            ? 'text-[var(--color-surface-900)]'
            : item.accent
            ? 'text-[var(--color-surface-600)]'
            : 'text-[var(--color-surface-400)]'
        )}
      />

      {!collapsed && (
        <>
          <span className="flex-1 truncate leading-none">{item.label}</span>

          {/* Accent badge for Investor Demo */}
          {item.accent && (
            <span className={cn(
              'text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded uppercase flex items-center gap-1',
              active
                ? 'bg-[var(--color-surface-200)] text-[var(--color-surface-700)]'
                : 'bg-[var(--color-success-50)] text-[var(--color-success-600)] border border-[var(--color-success-100)]'
            )}>
              <span className="w-1 h-1 rounded-full bg-current animate-pulse-live" />
              Live
            </span>
          )}
        </>
      )}
    </Link>
  );
}

// ── Mobile Overlay ────────────────────────────────────────────────────

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="fixed inset-0 bg-[var(--color-surface-900)]/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <Sidebar
        collapsed={false}
        onToggle={onClose}
        className="fixed left-0 top-0 z-50 shadow-xl animate-fade-in"
      />
    </div>
  );
}
