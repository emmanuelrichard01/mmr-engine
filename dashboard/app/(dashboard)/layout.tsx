'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Moon, Sun } from 'lucide-react';
import { MobileSidebar, NAV_ITEMS, Sidebar } from '@/components/sidebar';
import { DemoModeBanner } from '@/components/notices';
import { DEMO_MODE } from '@/lib/api';
import { useTheme } from '@/lib/use-theme';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, toggleTheme } = useTheme();
  const pathname = usePathname();

  const current = NAV_ITEMS.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-surface-50)]">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {DEMO_MODE && <DemoModeBanner />}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden lg:flex" aria-label="Sidebar">
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </aside>
        <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-[56px] shrink-0 items-center justify-between gap-4 border-b border-[var(--color-surface-200)] bg-[var(--color-surface-0)] px-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="icon-btn lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="truncate text-[13px] font-medium text-[var(--color-surface-600)]">
                <span className="hidden sm:inline">MMR</span>
                {current && (
                  <>
                    <span className="mx-2 hidden text-[var(--color-surface-400)] sm:inline" aria-hidden="true">
                      /
                    </span>
                    <span className="font-semibold text-[var(--color-surface-900)]">{current.label}</span>
                  </>
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="icon-btn"
              aria-label={`Switch to ${nextTheme} theme`}
              title={`Switch to ${nextTheme} theme`}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </header>

          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
            <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
