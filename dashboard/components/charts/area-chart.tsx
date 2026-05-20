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
    <div className="bg-surface-100 border border-surface-300 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-surface-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-surface-900">
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
  color = "#818cf8",
  gradientId = "area-gradient",
  yDomain,
  tooltipFormatter,
  xTickFormatter,
  height = 280,
}: AreaChartWrapperProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(30,32,48,0.6)"
          vertical={false}
        />

        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "#6b7094" }}
          tickFormatter={xTickFormatter}
          dy={8}
        />

        <YAxis
          domain={yDomain}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "#6b7094" }}
          dx={-4}
        />

        <Tooltip
          content={
            <CustomTooltip formatter={tooltipFormatter} />
          }
          cursor={{
            stroke: "rgba(99,102,241,0.3)",
            strokeWidth: 1,
            strokeDasharray: "4 4",
          }}
        />

        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{
            r: 5,
            stroke: color,
            strokeWidth: 2,
            fill: "#0f1117",
          }}
          animationDuration={1500}
          animationEasing="ease-out"
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
