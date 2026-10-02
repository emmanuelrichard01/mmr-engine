"use client";

import { useState, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Menu, Sun, Moon, LayoutDashboard, AlertTriangle,
  Activity, FileBarChart, Settings, TrendingUp, ChevronDown,
} from "lucide-react";
import { Sidebar, MobileSidebar } from "@/components/sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { WalkthroughProvider } from "@/components/walkthrough";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

// ── Route metadata ────────────────────────────────────────────────────

const PAGE_META: Record<string, { label: string; icon: typeof LayoutDashboard }> = {
  "/":              { label: "Overview",      icon: LayoutDashboard },
  "/discrepancies": { label: "Discrepancies", icon: AlertTriangle   },
  "/psp-health":    { label: "PSP Health",    icon: Activity        },
  "/reports":       { label: "Reports",       icon: FileBarChart    },
  "/settings":      { label: "Settings",      icon: Settings        },
  "/investor":      { label: "Investor Demo", icon: TrendingUp      },
};

// ── Root layout ───────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WalkthroughProvider>
      <DashboardShell>{children}</DashboardShell>
    </WalkthroughProvider>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────

function DashboardShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, toggleTheme } = useTheme();
  const pathname = usePathname();

  const page = useMemo(() => {
    const match = Object.entries(PAGE_META).find(([route]) =>
      route === "/" ? pathname === "/" : pathname.startsWith(route)
    );
    return match ? match[1] : { label: "Dashboard", icon: LayoutDashboard };
  }, [pathname]);

  const PageIcon = page.icon;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-surface-50)] selection:bg-[var(--color-primary-500)]/20">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        className="hidden lg:flex"
      />

      {/* Mobile sidebar overlay */}
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* ── Top bar ── */}
        <header className="sticky top-0 z-30 flex h-[56px] shrink-0 items-center justify-between border-b border-[var(--color-surface-200)] bg-[var(--color-surface-0)] px-4 lg:px-6 gap-4">

          {/* Left — mobile toggle + page breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--color-surface-500)] hover:text-[var(--color-surface-900)] hover:bg-[var(--color-surface-100)] transition-colors lg:hidden outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" strokeWidth={2} />
            </button>

            {/* Page breadcrumb — gives instant context, replaces dead search */}
            <div className="hidden lg:flex items-center gap-2 text-[13px]">
              <PageIcon className="w-3.5 h-3.5 text-[var(--color-surface-400)]" strokeWidth={2} />
              <span className="font-semibold text-[var(--color-surface-800)] tracking-tight">
                {page.label}
              </span>
            </div>
          </div>

          {/* Right — actions */}
          <div className="flex items-center gap-1">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--color-surface-400)] hover:text-[var(--color-surface-700)] hover:bg-[var(--color-surface-100)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
              title={`Switch to ${resolvedTheme === "light" ? "dark" : "light"} mode`}
              aria-label={`Switch to ${resolvedTheme === "light" ? "dark" : "light"} mode`}
            >
              {resolvedTheme === "light" ? (
                <Moon className="w-3.5 h-3.5" strokeWidth={2} />
              ) : (
                <Sun className="w-3.5 h-3.5" strokeWidth={2} />
              )}
            </button>

            {/* Notifications */}
            <div className="flex items-center justify-center w-8 h-8">
              <NotificationBell />
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--color-surface-200)] mx-1" />

            {/* Avatar */}
            <button
              className={cn(
                "flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-md transition-colors outline-none",
                "hover:bg-[var(--color-surface-100)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
              )}
              aria-label="Account menu"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                style={{ background: "var(--color-primary-500)" }}
              >
                ER
              </div>
              <ChevronDown className="w-3 h-3 text-[var(--color-surface-400)]" strokeWidth={2.5} />
            </button>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="flex-1 overflow-y-auto">
          {/* 
            Max width 1280px — matching Stripe/Linear/Vercel.
            Padding: px-6 py-6 lg:px-8 — consistent, no 3-breakpoint escalation.
          */}
          <div className="w-full max-w-[1280px] mx-auto px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
