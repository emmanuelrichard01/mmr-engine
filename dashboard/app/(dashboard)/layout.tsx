"use client";

import { useState, type ReactNode } from "react";
import {
  Bell,
  Search,
  ChevronRight,
  Menu,
} from "lucide-react";
import { Sidebar, MobileSidebar } from "@/components/sidebar";
import { NotificationBell } from "@/components/notification-bell";

// ── Layout ───────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      {/* ── Desktop Sidebar ── */}
      <div className="hidden lg:block">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
      </div>

      {/* ── Mobile Sidebar ── */}
      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      {/* ── Main Content ── */}
      <div
        className="flex-1 flex flex-col overflow-hidden transition-all duration-300"
        style={{ marginLeft: collapsed ? 72 : 260 }}
      >
        {/* Top bar */}
        <header className="flex items-center justify-between h-16 px-6 border-b border-surface-200 bg-surface-50/30 backdrop-blur-sm shrink-0">
          {/* Mobile hamburger */}
          <button
            className="flex lg:hidden items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-200/60 text-surface-500 transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Breadcrumb (desktop) */}
          <div className="hidden lg:flex items-center gap-1.5 text-sm">
            <span className="text-surface-500">Dashboard</span>
            <ChevronRight className="w-3.5 h-3.5 text-surface-400" />
            <span className="font-medium text-surface-800">
              Executive Overview
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Search */}
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-100 border border-surface-200 text-surface-500 text-sm hover:border-surface-300 transition-colors">
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="hidden md:inline text-[10px] bg-surface-200 px-1.5 py-0.5 rounded font-mono">
                ⌘K
              </kbd>
            </button>

            {/* Notifications */}
            <NotificationBell />

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <span className="text-xs font-semibold text-white">RE</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
