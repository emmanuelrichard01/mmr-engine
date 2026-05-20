'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { HelpCircle, X, ChevronDown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Info Tooltip ─────────────────────────────────────────────────────
// Inline (?) icon with hover/click tooltip — Apple-style frosted glass

interface InfoTooltipProps {
  content: string;
  className?: string;
}

export function InfoTooltip({ content, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="p-0.5 rounded-full text-[var(--color-surface-400)] hover:text-[var(--color-surface-600)] hover:bg-[var(--color-surface-200)]/60 transition-all"
        aria-label="More info"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 animate-fade-in">
          <div className="relative px-3.5 py-2.5 rounded-xl text-xs leading-relaxed text-[var(--color-surface-700)] bg-[var(--color-surface-50)]/95 backdrop-blur-xl border border-[var(--color-surface-200)]/80 shadow-lg shadow-black/[0.08]">
            {content}
            {/* Arrow */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[var(--color-surface-50)]/95 border-r border-b border-[var(--color-surface-200)]/80" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page Help Panel ──────────────────────────────────────────────────
// Collapsible help section — Notion-style clean expandable

interface HelpItem {
  term: string;
  definition: string;
}

interface PageHelpProps {
  title?: string;
  description?: string;
  items: HelpItem[];
  className?: string;
}

export function PageHelp({
  title = 'Understanding this page',
  description,
  items,
  className,
}: PageHelpProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn('group', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-200',
          isOpen
            ? 'bg-[var(--color-primary-500)]/10 text-[var(--color-primary-400)] border border-[var(--color-primary-500)]/20'
            : 'text-[var(--color-surface-500)] hover:text-[var(--color-surface-700)] hover:bg-[var(--color-surface-100)] border border-transparent'
        )}
      >
        <HelpCircle className="w-3.5 h-3.5" />
        <span>{isOpen ? 'Hide guide' : 'What am I looking at?'}</span>
        <ChevronDown
          className={cn(
            'w-3 h-3 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="mt-3 animate-fade-in">
          <div className="rounded-2xl border border-[var(--color-surface-200)]/80 bg-[var(--color-surface-50)]/80 backdrop-blur-sm overflow-hidden">
            {/* Header */}
            {(title || description) && (
              <div className="px-5 pt-4 pb-3 border-b border-[var(--color-surface-200)]/60">
                {title && (
                  <h3 className="text-sm font-semibold text-[var(--color-surface-800)]">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-xs text-[var(--color-surface-500)] mt-1 leading-relaxed">
                    {description}
                  </p>
                )}
              </div>
            )}

            {/* Items */}
            <div className="divide-y divide-[var(--color-surface-200)]/40">
              {items.map((item, i) => (
                <div
                  key={i}
                  className="px-5 py-3 hover:bg-[var(--color-surface-100)]/50 transition-colors"
                >
                  <dt className="text-xs font-semibold text-[var(--color-surface-700)]">
                    {item.term}
                  </dt>
                  <dd className="text-[11px] text-[var(--color-surface-500)] mt-0.5 leading-relaxed">
                    {item.definition}
                  </dd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Metric Label with Tooltip ────────────────────────────────────────
// Use this to wrap metric titles with an inline info button

interface MetricLabelProps {
  children: ReactNode;
  tooltip: string;
  className?: string;
}

export function MetricLabel({ children, tooltip, className }: MetricLabelProps) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {children}
      <InfoTooltip content={tooltip} />
    </span>
  );
}
