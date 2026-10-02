import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Skeleton } from '@/components/page-header';
import { cn } from '@/lib/utils';

export interface KpiDelta {
  /** Signed value, used only to pick the arrow. */
  value: number;
  /** Pre-formatted with explicit units, e.g. "+0.4 pp" or "−120". */
  label: string;
  /** What the delta compares against, e.g. "vs 1 Oct". */
  basis: string;
  /** Volume-like metrics: direction is shown without a good/bad colour. */
  neutral?: boolean;
  /** For risk metrics a decrease is good. */
  lowerIsBetter?: boolean;
}

export interface KpiCardProps {
  label: string;
  value: string;
  /** Short supporting line under the value. */
  detail?: ReactNode;
  delta?: KpiDelta | null;
  /** Real series only; omitted when there is no history to show. */
  sparkline?: number[];
  sparklineLabel?: string;
  loading?: boolean;
  unavailable?: boolean;
}

function Sparkline({ data, label }: { data: number[]; label: string }) {
  if (data.length < 2) return null;
  const width = 72;
  const height = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" role="img" aria-label={label}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--color-surface-500)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KpiCard({ label, value, detail, delta, sparkline, sparklineLabel, loading, unavailable }: KpiCardProps) {
  if (loading) {
    return (
      <div className="card flex min-h-[116px] flex-col gap-3" aria-busy="true">
        <span className="text-caption">{label}</span>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  const direction = !delta || delta.value === 0 ? 'flat' : delta.value > 0 ? 'up' : 'down';
  const good =
    direction === 'flat' || delta?.neutral ? null : delta?.lowerIsBetter ? direction === 'down' : direction === 'up';
  const DeltaIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;

  return (
    <div className="card flex min-h-[116px] flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-caption">{label}</span>
        {sparkline && !unavailable && <Sparkline data={sparkline} label={sparklineLabel ?? `${label} trend`} />}
      </div>
      <p className="text-financial text-[26px] font-semibold leading-none tracking-tight text-[var(--color-surface-900)]">
        {unavailable ? '—' : value}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {delta && !unavailable && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium tabular-nums',
              good === null
                ? 'text-[var(--color-surface-600)]'
                : good
                  ? 'text-[var(--color-success-600)]'
                  : 'text-[var(--color-danger-600)]',
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {delta.label}
            <span className="font-normal text-[var(--color-surface-500)]">{delta.basis}</span>
          </span>
        )}
        {detail && <span className="text-[var(--color-surface-500)]">{detail}</span>}
      </div>
    </div>
  );
}
