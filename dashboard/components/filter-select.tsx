'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/** A compact labelled select for toolbars. "Any …" clears the filter. */
export function FilterSelect<V extends string>({
  label,
  value,
  options,
  onChange,
  anyLabel,
  className,
}: {
  label: string;
  value: V | undefined;
  options: readonly { value: V; label: string }[];
  onChange: (value: V | undefined) => void;
  anyLabel: string;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cn('inline-flex', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        className="select select-sm w-auto"
        data-active={value !== undefined}
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as V | undefined)}
      >
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
