"use client";

import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────

interface AreaChartWrapperProps {
  data: Record<string, unknown>[];
  dataKey: string;
  xKey: string;
  color?: string;
  gradientId?: string;
  yDomain?: [number | string, number | string];
  tooltipFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
  height?: number;
}

// ── Custom Tooltip ───────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[var(--color-surface-0)] border border-[var(--color-surface-200)] rounded-lg px-3 py-2.5 shadow-lg">
      <p className="text-overline text-[10px] mb-1">{label}</p>
      <p className="text-[14px] font-bold text-[var(--color-surface-900)] tabular-nums">
        {formatter ? formatter(payload[0].value) : payload[0].value}
      </p>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────

export function AreaChartWrapper({
  data,
  dataKey,
  xKey,
  color = "var(--color-primary-500)",
  gradientId = "area-gradient",
  yDomain,
  tooltipFormatter,
  xTickFormatter,
  height = 260,
}: AreaChartWrapperProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart
        data={data}
        margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.12} />
            <stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        <CartesianGrid
          stroke="var(--color-surface-200)"
          strokeOpacity={0.6}
          vertical={false}
          strokeDasharray="none"
        />

        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tick={{
            fontSize: 11,
            fill: "var(--color-surface-400)",
            fontWeight: 500,
          }}
          tickFormatter={xTickFormatter}
          dy={8}
        />

        <YAxis
          domain={yDomain}
          tickLine={false}
          axisLine={false}
          tick={{
            fontSize: 11,
            fill: "var(--color-surface-400)",
            fontWeight: 500,
          }}
          dx={-4}
        />

        <Tooltip
          content={
            <CustomTooltip formatter={tooltipFormatter} />
          }
          cursor={{
            stroke: "var(--color-surface-300)",
            strokeOpacity: 0.5,
            strokeWidth: 1,
          }}
        />

        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{
            r: 4,
            stroke: color,
            strokeWidth: 2,
            fill: "var(--color-surface-0)",
          }}
          animationDuration={1200}
          animationEasing="ease-out"
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
