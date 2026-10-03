'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const noop = () => () => {};

/**
 * Renders overlays at the end of <body>, outside any transformed ancestor (the
 * page transition), so fixed positioning is always relative to the viewport.
 * Renders nothing on the server.
 */
export function Portal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return mounted ? createPortal(children, document.body) : null;
}
