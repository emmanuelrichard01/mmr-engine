import { Skeleton } from '@/components/page-header';

export function InboxRowsSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex h-[var(--row-h-lg)] items-center gap-3 border-b border-line px-4">
          <Skeleton className="h-4 w-4 rounded-[4px]" />
          <Skeleton className="h-2 w-2" />
          <span className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${46 + ((i * 17) % 30)}%` }} />
            <Skeleton className="h-3 w-32" />
          </span>
          <span className="space-y-1.5">
            <Skeleton className="ml-auto h-3.5 w-20" />
            <Skeleton className="ml-auto h-3 w-8" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Same frame as the inbox: header, tabs, filter bar, list and detail pane. */
export function InboxSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <span role="status" className="sr-only">
        Loading inbox
      </span>
      <div className="border-b border-line px-[var(--page-x)] pt-7">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
        <div className="mt-5 flex gap-5 pb-3">
          {[48, 84, 64, 64, 88, 24].map((w, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-full border-r border-line lg:w-[460px]">
          <div className="flex h-[52px] items-center gap-2 border-b border-line px-4">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-7 w-28" />
          </div>
          <InboxRowsSkeleton />
        </div>
        <div className="hidden flex-1 p-8 lg:block">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-3 h-4 w-40" />
          <div className="mt-8 grid grid-cols-3 gap-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
          <Skeleton className="mt-8 h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
