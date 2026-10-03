'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Menu, Search, X } from 'lucide-react';
import { DemoModeBanner } from '@/components/notices';
import { Toaster } from '@/components/toaster';
import { DEMO_MODE } from '@/lib/api';
import { DURATION, EASE_OUT, SPRING_PANEL } from '@/lib/motion';
import { NAV_ITEMS, currentNav } from '@/lib/nav';
import { useHotkeys } from '@/lib/use-hotkeys';
import { useModal } from '@/lib/use-modal';
import { BrandMark, Sidebar } from './sidebar';
import { CommandPalette } from './command-palette';
import { ShortcutsDialog } from './shortcuts-dialog';

function MobileNav({
  onClose,
  onOpenPalette,
  onOpenShortcuts,
}: {
  onClose: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}) {
  const ref = useModal<HTMLDivElement>(true, onClose);
  const reduce = useReducedMotion();
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <motion.div
        className="scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex shadow-[var(--shadow-overlay)] outline-none"
        initial={reduce ? { opacity: 0 } : { x: -40, opacity: 0 }}
        animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { x: -32, opacity: 0, transition: { duration: DURATION.base } }}
        transition={reduce ? { duration: DURATION.fast } : SPRING_PANEL}
      >
        <Sidebar onNavigate={onClose} onOpenPalette={onOpenPalette} onOpenShortcuts={onOpenShortcuts} />
        <button type="button" onClick={onClose} className="icon-btn absolute right-2 top-3" aria-label="Close navigation" data-autofocus>
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </motion.div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = currentNav(pathname);

  // Leaving a page closes the mobile navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  const openPalette = useCallback(() => {
    setMobileOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openShortcuts = useCallback(() => {
    setMobileOpen(false);
    setShortcutsOpen(true);
  }, []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  useHotkeys(
    {
      'mod+k': () => setPaletteOpen((o) => !o),
    },
    { allowInInputs: true, allowInDialogs: true },
  );

  const goTo: Record<string, () => void> = {};
  for (const item of NAV_ITEMS) goTo[`g ${item.key}`] = () => router.push(item.href);
  useHotkeys({ '?': openShortcuts, ...goTo });

  // After a client-side navigation, move focus to the new page's content (not on first load).
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = '';
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    // reducedMotion="user": with the OS setting on, transform and layout
    // animations are dropped and only opacity fades remain.
    <MotionConfig reducedMotion="user">
      <Toaster>
        <div className="flex h-dvh overflow-hidden bg-bg">
          <a href="#main" className="skip-link">
            Skip to content
          </a>

          <aside className="hidden border-r border-line lg:flex" aria-label="Sidebar">
            <Sidebar onOpenPalette={openPalette} onOpenShortcuts={openShortcuts} />
          </aside>

          <AnimatePresence>
            {mobileOpen && (
              <MobileNav
                key="mobile-nav"
                onClose={() => setMobileOpen(false)}
                onOpenPalette={openPalette}
                onOpenShortcuts={openShortcuts}
              />
            )}
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg-subtle px-3 lg:hidden">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </button>
              <BrandMark className="h-6 w-6" />
              <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{current?.label ?? 'MMR'}</p>
              <button type="button" className="icon-btn" onClick={openPalette} aria-label="Search or jump to">
                <Search className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </header>

            {DEMO_MODE && <DemoModeBanner />}

            <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-y-auto outline-none">
              {children}
            </main>
          </div>

          <CommandPalette open={paletteOpen} onClose={closePalette} onOpenShortcuts={openShortcuts} />
          <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
        </div>
      </Toaster>
    </MotionConfig>
  );
}
