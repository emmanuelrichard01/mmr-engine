'use client';

import { useMemo } from 'react';
import { useReducedMotion } from 'motion/react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendDay } from '@/lib/api';
import { formatNgn, koboRatio, maxKobo, toKobo } from '@/lib/money';
import { formatCalendarDate, formatCount, formatPercent } from '@/lib/utils';

// Match rate (line, accent) over daily volume (bars, neutral). Bars are drawn
// from a 0–100 index computed in integer kobo, so no money is converted to a
// float; the tooltip shows the exact amount from the API.

interface Row extends TrendDay {
  volumeIndex: number;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <p className="mb-2 text-[12px] font-medium text-fg-subtle">{formatCalendarDate(d.date)}</p>
      <dl className="space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <dt className="flex items-center gap-2 text-fg-muted">
            <span className="h-[2px] w-3 rounded-full bg-accent" aria-hidden="true" />
            Match rate
          </dt>
          <dd className="num font-semibold text-fg">{formatPercent(d.match_rate_pct, 2)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="flex items-center gap-2 text-fg-muted">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--color-chart-bar)]" aria-hidden="true" />
            Volume
          </dt>
          <dd className="num font-semibold text-fg">{formatNgn(d.volume_ngn)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6 pt-1">
          <dt className="text-fg-subtle">Matched</dt>
          <dd className="num text-fg-muted">
            {formatCount(d.matched)} of {formatCount(d.total)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="text-fg-subtle">Discrepancies raised</dt>
          <dd className="num text-fg-muted">{formatCount(d.discrepancies_raised)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function TrendChart({ days, height = 280 }: { days: TrendDay[]; height?: number }) {
  const reduce = useReducedMotion();
  const rows = useMemo<Row[]>(() => {
    const kobos = days.map((d) => toKobo(d.volume_ngn) ?? BigInt(0));
    const max = maxKobo(kobos);
    return days.map((d, i) => ({ ...d, volumeIndex: koboRatio(kobos[i], max) * 100 }));
  }, [days]);

  const rateDomain = useMemo<[number, number]>(() => {
    const rates = days.map((d) => d.match_rate_pct).filter((v): v is number => v !== null);
    if (!rates.length) return [0, 100];
    return [Math.max(0, Math.floor(Math.min(...rates) - 2)), 100];
  }, [days]);

  const tick = { fontSize: 12, fill: 'var(--color-fg-subtle)' };
  const animate = !reduce;

  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={tick}
            tickFormatter={(d: string) => formatCalendarDate(d, false)}
            minTickGap={28}
            dy={8}
          />
          <YAxis
            yAxisId="rate"
            domain={rateDomain}
            tickLine={false}
            axisLine={false}
            tick={tick}
            tickFormatter={(v: number) => `${v}%`}
            width={44}
          />
          <YAxis yAxisId="volume" orientation="right" domain={[0, 115]} hide />
          <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--color-panel-hover)' }} isAnimationActive={false} />
          <Bar
            yAxisId="volume"
            dataKey="volumeIndex"
            fill="var(--color-chart-bar)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={animate}
            animationDuration={600}
            animationEasing="ease-out"
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="match_rate_pct"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            activeDot={{ r: 4, stroke: 'var(--color-panel)', strokeWidth: 2, fill: 'var(--color-accent)' }}
            isAnimationActive={animate}
            animationDuration={600}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
