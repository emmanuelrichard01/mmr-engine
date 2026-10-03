'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  count?: number | null;
}

/**
 * WAI-ARIA tabs (automatic activation): arrow keys move between tabs, Home and
 * End jump to the ends. The underline slides between tabs.
 */
export function TabList<V extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
  className,
}: {
  label: string;
  tabs: readonly TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Prefix for tab/panel ids so panels can reference their tab. */
  idBase: string;
  className?: string;
}) {
  const layoutId = useId();
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].value);
  }

  return (
    <div role="tablist" aria-label={label} className={cn('tabs', className)}>
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idBase}-tab-${t.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idBase}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="tab"
          >
            {t.label}
            {t.count !== undefined && t.count !== null && <span className="tab-count">{t.count.toLocaleString('en-NG')}</span>}
            {selected && (
              <motion.span layoutId={reduce ? undefined : layoutId} className="tab-indicator" transition={SPRING_SNAPPY} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for the selected tab; content cross-fades when the tab changes. */
export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${value}`} className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={value}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
