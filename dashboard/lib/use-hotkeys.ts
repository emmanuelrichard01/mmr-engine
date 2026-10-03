'use client';

import { useEffect, useRef } from 'react';

// Keyboard shortcuts. Bindings are written as "mod+k", "shift+e", "?", "j",
// or two-key sequences such as "g i" (press g, then i within a second).
// "mod" is ⌘ on macOS and Ctrl elsewhere. Shortcuts never fire while the
// viewer types in a field, and page-level ones pause while a dialog is open.

export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyOptions {
  /** Fire even when focus is in a text field (for mod+k). */
  allowInInputs?: boolean;
  /** Fire even when a modal dialog is open. */
  allowInDialogs?: boolean;
  enabled?: boolean;
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
  }
  return false;
}

export function dialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** "shift+e", "mod+k", "?", "enter", "escape". */
export function comboOf(e: KeyboardEvent): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Shift is part of the combo for letters and named keys, not for symbols it produces ("?").
  if (e.shiftKey && (/^[a-z]$/.test(key) || key.length > 1)) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

export function useHotkeys(bindings: Record<string, HotkeyHandler>, options: HotkeyOptions = {}) {
  const { allowInInputs = false, allowInDialogs = false, enabled = true } = options;
  const bindingsRef = useRef(bindings);
  useEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let pendingTimer: number | undefined;

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const combo = comboOf(e);
      const map = bindingsRef.current;
      const editable = isEditable(e.target);
      const isGlobalCombo = combo.startsWith('mod+');
      if (editable && !(allowInInputs && isGlobalCombo)) return;
      if (!allowInDialogs && dialogOpen()) return;

      if (pending) {
        const seq = `${pending} ${combo}`;
        pending = null;
        window.clearTimeout(pendingTimer);
        if (map[seq]) {
          e.preventDefault();
          map[seq](e);
          return;
        }
      }

      if (map[combo]) {
        e.preventDefault();
        map[combo](e);
        return;
      }

      if (Object.keys(map).some((k) => k.startsWith(`${combo} `))) {
        pending = combo;
        pendingTimer = window.setTimeout(() => {
          pending = null;
        }, 1000);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(pendingTimer);
    };
  }, [allowInInputs, allowInDialogs, enabled]);
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere; null until mounted so SSR markup is stable. */
export function modKeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}
