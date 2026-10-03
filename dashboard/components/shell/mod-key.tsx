'use client';

import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

const noop = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple platforms, "Ctrl" elsewhere. Server render says "Ctrl"; hydration then corrects it. */
export function useModKey(): string {
  return useSyncExternalStore(noop, () => (isApple() ? '⌘' : 'Ctrl'), () => 'Ctrl');
}

export function ModKeyHint({ letter, className }: { letter: string; className?: string }) {
  const mod = useModKey();
  return (
    <kbd className={cn('kbd h-[18px] gap-0.5 px-1 text-[11.5px]', className)} aria-hidden="true">
      {mod === '⌘' ? `⌘${letter}` : `Ctrl ${letter}`}
    </kbd>
  );
}
