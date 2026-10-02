'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface TooltipPayload {
  value: number | null;
  payload: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
  extra,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  valueFormatter: (value: number | null) => string;
  labelFormatter: (label: string) => string;
  extra?: (row: Record<string, unknown>) => string | null;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const extraText = extra ? extra(row) : null;
  return (
    <div className="chart-tooltip">
      <p className="text-caption">{label ? labelFormatter(label) : ''}</p>
      <p className="text-financial text-[14px] font-semibold text-[var(--color-surface-900)]">
        {valueFormatter(payload[0].value)}
      </p>
      {extraText && <p className="text-caption">{extraText}</p>}
    </div>
  );
}

export interface AreaChartProps<T extends object> {
  data: T[];
  dataKey: keyof T & string;
  xKey: keyof T & string;
  /** Accessible description of what the chart shows. */
  ariaLabel: string;
  yDomain?: [number, number];
  valueFormatter: (value: number | null) => string;
  xTickFormatter: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  tooltipExtra?: (row: T) => string | null;
  height?: number;
}

export function AreaChartWrapper<T extends object>({
  data,
  dataKey,
  xKey,
  ariaLabel,
  yDomain,
  valueFormatter,
  xTickFormatter,
  yTickFormatter,
  tooltipExtra,
  height = 240,
}: AreaChartProps<T>) {
  const tick = { fontSize: 12, fill: 'var(--color-surface-500)' };
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="mmr-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary-500)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--color-primary-500)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-surface-200)" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={tick}
            tickFormatter={xTickFormatter}
            minTickGap={24}
            dy={6}
          />
          <YAxis
            domain={yDomain}
            tickLine={false}
            axisLine={false}
            tick={tick}
            tickFormatter={yTickFormatter}
            width={48}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={valueFormatter}
                labelFormatter={xTickFormatter}
                extra={tooltipExtra as unknown as ((row: Record<string, unknown>) => string | null) | undefined}
              />
            }
            cursor={{ stroke: 'var(--color-surface-300)', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke="var(--color-primary-500)"
            strokeWidth={1.75}
            fill="url(#mmr-area-fill)"
            dot={false}
            activeDot={{ r: 3.5, stroke: 'var(--color-primary-500)', strokeWidth: 2, fill: 'var(--color-surface-0)' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
