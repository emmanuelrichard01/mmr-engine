'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  DENSITY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type Density,
  type ThemePreference,
} from '@/lib/theme-script';

// Preferences live on <html> attributes, set before first paint by
// THEME_SCRIPT (see app/layout.tsx). React reads them through
// useSyncExternalStore; the server snapshot matches the script's defaults.

type Resolved = 'light' | 'dark';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function attr(name: string): string | null {
  return document.documentElement.getAttribute(name);
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(pref: ThemePreference) {
  const resolved: Resolved = pref === 'dark' || (pref === 'system' && systemDark()) ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-pref', pref);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (attr('data-theme-pref') === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onSystemChange);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener('change', onSystemChange);
  };
}

const readResolved = (): Resolved => (attr('data-theme') === 'dark' ? 'dark' : 'light');
const readPref = (): ThemePreference => {
  const v = attr('data-theme-pref');
  return v === 'light' || v === 'dark' ? v : 'system';
};
const readDensity = (): Density => (attr('data-density') === 'compact' ? 'compact' : 'comfortable');

export function useTheme() {
  const resolvedTheme = useSyncExternalStore<Resolved>(subscribe, readResolved, () => 'light');
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPref, () => 'system');

  const setPreference = useCallback((pref: ThemePreference) => {
    store(THEME_STORAGE_KEY, pref);
    applyTheme(pref);
  }, []);

  /** Flip to the opposite of what is showing now. */
  const toggleTheme = useCallback(() => {
    const next: Resolved = readResolved() === 'dark' ? 'light' : 'dark';
    store(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  return { resolvedTheme, preference, setPreference, toggleTheme };
}

export function useDensity() {
  const density = useSyncExternalStore<Density>(subscribe, readDensity, () => 'comfortable');
  const setDensity = useCallback((next: Density) => {
    store(DENSITY_STORAGE_KEY, next);
    document.documentElement.setAttribute('data-density', next);
    notify();
  }, []);
  const toggleDensity = useCallback(() => {
    setDensity(readDensity() === 'compact' ? 'comfortable' : 'compact');
  }, [setDensity]);
  return { density, setDensity, toggleDensity };
}
