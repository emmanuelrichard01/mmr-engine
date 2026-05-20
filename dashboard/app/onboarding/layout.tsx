import type { ReactNode } from 'react';

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--color-surface-0)] via-[var(--color-surface-50)] to-[var(--color-surface-100)]">
      {/* Subtle background pattern */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--color-surface-500) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top brand bar */}
      <header className="relative flex items-center justify-center h-16 border-b border-[var(--color-surface-200)]/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)]">
            <span className="text-xs font-bold text-white tracking-wider">
              M
            </span>
          </div>
          <span className="text-lg font-bold text-[var(--color-surface-900)] tracking-tight">
            MMR Reconciliation
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="relative flex flex-col items-center px-4 py-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
