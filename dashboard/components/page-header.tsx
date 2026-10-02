import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-display">{title}</h1>
          {badge}
        </div>
        {description && <div className="text-body mt-1">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  id,
  actions,
}: {
  title: string;
  description?: ReactNode;
  id?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="text-heading">
          {title}
        </h2>
        {description && <p className="text-caption mt-0.5">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-shimmer rounded ${className ?? ''}`} />;
}
