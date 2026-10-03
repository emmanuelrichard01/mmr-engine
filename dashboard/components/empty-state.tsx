import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Empty states say what would appear here and how it gets there. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 text-center', compact ? 'py-8' : 'py-14', className)}>
      {icon && (
        <div
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-[10px] bg-inset text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <p className="text-[14px] font-semibold text-fg">{title}</p>
      {description && <p className="t-body mt-1 max-w-[46ch] text-[13px]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
