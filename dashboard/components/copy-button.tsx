'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Copies a value (ids, references) and confirms in place. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      className={cn('icon-btn h-6 w-6 rounded-[5px]', className)}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-positive" strokeWidth={2} aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  );
}
