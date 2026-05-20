'use client';

import { useState } from 'react';
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
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Navigation Items ─────────────────────────────────────────────────────────

const navItems = [
  {
    label: 'Overview',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    label: 'Discrepancies',
    href: '/discrepancies',
    icon: AlertTriangle,
  },
  {
    label: 'PSP Health',
    href: '/psp-health',
    icon: Activity,
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: FileBarChart,
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

// ─── Sidebar Component ───────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function Sidebar({ collapsed, onToggle, className }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-surface-200 bg-surface-50 transition-all duration-300 ease-in-out',
        collapsed ? 'w-[72px]' : 'w-[260px]',
        className
      )}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex h-16 items-center border-b border-surface-200 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-500 font-bold text-white text-sm">
            M
          </div>
          <span
            className={cn(
              'whitespace-nowrap font-bold text-lg text-surface-900 transition-opacity duration-200',
              collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
            )}
          >
            MMR
          </span>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary-500/10 text-primary-400'
                  : 'text-surface-600 hover:bg-surface-200/60 hover:text-surface-800'
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <div className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-500" />
              )}

              <Icon
                className={cn(
                  'h-5 w-5 shrink-0 transition-colors',
                  isActive
                    ? 'text-primary-400'
                    : 'text-surface-500 group-hover:text-surface-700'
                )}
              />

              <span
                className={cn(
                  'whitespace-nowrap transition-opacity duration-200',
                  collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom Section ───────────────────────────────────────────────── */}
      <div className="border-t border-surface-200 p-3">
        {/* User Avatar */}
        <div className="mb-3 flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-300 text-surface-700">
            <User className="h-4 w-4" />
          </div>
          <div
            className={cn(
              'min-w-0 transition-opacity duration-200',
              collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
            )}
          >
            <p className="truncate text-sm font-medium text-surface-800">
              Demo User
            </p>
            <p className="truncate text-xs text-surface-500">
              demo@mmr.finance
            </p>
          </div>
        </div>

        {/* Collapse Toggle */}
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-surface-500 transition-colors hover:bg-surface-200/60 hover:text-surface-700"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span className="text-xs font-medium">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

// ─── Mobile Sidebar Overlay ──────────────────────────────────────────────────

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sidebar */}
      <Sidebar
        collapsed={false}
        onToggle={onClose}
        className="relative z-50 shadow-2xl"
      />
    </div>
  );
}
