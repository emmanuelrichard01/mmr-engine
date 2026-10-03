'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCount } from '@/lib/utils';

/**
 * Offset pagination. With a known total it says "1–50 of 1,284"; without one
 * (endpoints that return only a page) "Next" is enabled while a page is full.
 */
export function Pagination({
  offset,
  pageSize,
  shown,
  total,
  onChange,
  busy,
  noun = 'rows',
}: {
  offset: number;
  pageSize: number;
  shown: number;
  total?: number | null;
  onChange: (offset: number) => void;
  busy?: boolean;
  noun?: string;
}) {
  const hasTotal = typeof total === 'number';
  const hasNext = hasTotal ? offset + shown < (total as number) : shown === pageSize;
  const label =
    shown === 0
      ? `No ${noun}`
      : `${formatCount(offset + 1)}–${formatCount(offset + shown)}${hasTotal ? ` of ${formatCount(total)}` : ''}`;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-2.5">
      <p className="t-caption num" aria-live="polite">
        {label}
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          className="icon-btn h-8 w-8"
          disabled={offset === 0 || busy}
          aria-label="Previous page"
          onClick={() => onChange(Math.max(0, offset - pageSize))}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn h-8 w-8"
          disabled={!hasNext || busy}
          aria-label="Next page"
          onClick={() => onChange(offset + pageSize)}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
