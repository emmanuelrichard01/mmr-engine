'use client';

import { useId, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SPRING_SNAPPY } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A row of mutually exclusive toggle buttons with a sliding thumb. Each
 * option is a button with aria-pressed, inside a labelled group.
 */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  className,
  hideLabel = true,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: ReactNode; title?: string }[];
  onChange: (value: V) => void;
  className?: string;
  hideLabel?: boolean;
}) {
  const layoutId = useId();
  const labelId = useId();
  const reduce = useReducedMotion();
  return (
    <div className={cn('inline-flex flex-col gap-1.5', className)}>
      <span id={labelId} className={hideLabel ? 'sr-only' : 't-label'}>
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="seg">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              title={o.title}
              onClick={() => onChange(o.value)}
              className="seg-item"
            >
              {active && (
                <motion.span
                  layoutId={reduce ? undefined : layoutId}
                  className="seg-thumb"
                  transition={SPRING_SNAPPY}
                  aria-hidden="true"
                />
              )}
              <span className="relative z-[1] inline-flex items-center gap-1.5">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
