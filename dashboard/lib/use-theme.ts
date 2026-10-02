'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY as STORAGE_KEY } from '@/lib/theme-script';

// The resolved theme lives on <html data-theme>, set before first paint by
// THEME_SCRIPT (see app/layout.tsx) so there is no flash. React reads it via
// useSyncExternalStore; the server snapshot is "light", so hydration matches.

type Resolved = 'light' | 'dark';

const listeners = new Set<() => void>();

function readTheme(): Resolved {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function apply(theme: Resolved) {
  document.documentElement.setAttribute('data-theme', theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored !== 'light' && stored !== 'dark') apply(mq.matches ? 'dark' : 'light');
  };
  mq.addEventListener('change', onSystemChange);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener('change', onSystemChange);
  };
}

export function useTheme() {
  const resolvedTheme = useSyncExternalStore<Resolved>(subscribe, readTheme, () => 'light');
  const toggleTheme = useCallback(() => {
    const next: Resolved = readTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode); the choice lasts for this page only.
    }
    apply(next);
  }, []);
  return { resolvedTheme, toggleTheme };
}
