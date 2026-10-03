'use client';

import type { RefObject } from 'react';
import { useHotkeys } from './use-hotkeys';

/**
 * j/k move focus between the row buttons ([data-row-button]) inside a table,
 * and "/" focuses the page's search field. Enter on a focused row button
 * opens it natively.
 */
export function useRowKeys(container: RefObject<HTMLElement | null>, search?: RefObject<HTMLInputElement | null>) {
  function step(delta: number) {
    const rows = Array.from(container.current?.querySelectorAll<HTMLElement>('[data-row-button]') ?? []);
    if (!rows.length) return;
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next = index === -1 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta));
    rows[next].focus();
    rows[next].scrollIntoView({ block: 'nearest' });
  }
  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    '/': () => search?.current?.focus(),
  });
}
