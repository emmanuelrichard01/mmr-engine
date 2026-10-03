'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { applyPatch, parseParams, toSearch, type Schema, type ValuesOf } from './url-state';

/**
 * Read and write a schema of query parameters. Writes go through the History
 * API, which Next.js keeps in sync with useSearchParams, so changing a filter
 * or moving the inbox cursor never refetches the page from the server.
 * Filters replace the history entry; opening a record can push one.
 */
export function useUrlState<S extends Schema>(
  schema: S,
  options: { resetKey?: keyof S & string; resetOnChange?: readonly (keyof S & string)[] } = {},
) {
  const searchParams = useSearchParams();
  const raw = searchParams.toString();
  const values = useMemo(() => parseParams(schema, new URLSearchParams(raw)), [schema, raw]);

  const { resetKey, resetOnChange } = options;
  const set = useCallback(
    (patch: Partial<ValuesOf<S>>, mode: 'replace' | 'push' = 'replace') => {
      const current = parseParams(schema, new URLSearchParams(window.location.search));
      const next = applyPatch(schema, current, patch, { resetKey, resetOnChange });
      const url = `${window.location.pathname}${toSearch(schema, next)}`;
      if (url === `${window.location.pathname}${window.location.search}`) return;
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [schema, resetKey, resetOnChange],
  );

  return [values, set] as const;
}
