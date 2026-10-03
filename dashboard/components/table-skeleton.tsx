import { Skeleton } from './page-header';

const WIDTHS = [62, 44, 38, 56, 40, 48, 30, 52];

export function TableRowsSkeleton({ columns, rows = 10 }: { columns: number; rows?: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <Skeleton className="h-3.5" style={{ width: `${WIDTHS[(c + r) % WIDTHS.length]}%`, minWidth: 28 }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Page-level fallback shaped like a header, a toolbar and a table. */
export function TableSkeleton({ title, columns }: { title: string; columns: number }) {
  return (
    <div className="page space-y-6" aria-busy="true">
      <span role="status" className="sr-only">
        Loading {title}
      </span>
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="panel overflow-hidden">
        <div className="flex h-[56px] items-center gap-2 border-b border-line px-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
        </div>
        <table className="table">
          <TableRowsSkeleton columns={columns} />
        </table>
      </div>
    </div>
  );
}
