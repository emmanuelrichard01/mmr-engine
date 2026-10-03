import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  badge,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="t-display">{title}</h1>
          {badge}
        </div>
        {description && <div className="t-body mt-1.5 max-w-[68ch]">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  id,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  id?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 id={id} className="t-title">
          {title}
        </h2>
        {description && <p className="t-caption mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A placeholder block shaped like the content it stands in for. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn('skeleton block', className)} style={style} />;
}

/** Visually hidden status for screen readers while a region loads. */
export function LoadingLabel({ what }: { what: string }) {
  return (
    <span role="status" className="sr-only">
      Loading {what}
    </span>
  );
}
