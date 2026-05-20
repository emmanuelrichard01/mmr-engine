"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  LabelList,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────

interface BarChartDatum {
  name: string;
  value: number;
  color: string;
  [key: string]: unknown;
}

interface BarChartWrapperProps {
  data: BarChartDatum[];
  layout?: "horizontal" | "vertical";
  tooltipFormatter?: (value: number) => string;
  labelFormatter?: (value: number) => string;
  height?: number;
  barSize?: number;
}

// ── Custom Tooltip ───────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  formatter,
}: {
  active?: boolean;
  payload?: { value: number; payload: BarChartDatum }[];
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];

  return (
    <div className="bg-surface-100 border border-surface-300 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-surface-500 mb-0.5">{entry.payload.name}</p>
      <p className="text-sm font-semibold text-surface-900">
        {formatter ? formatter(entry.value) : entry.value.toLocaleString()}
      </p>
    </div>
  );
}

// ── Custom Label ─────────────────────────────────────────────────────

function renderCustomLabel(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
  formatter?: (v: number) => string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, value = 0, formatter } = props;
  return (
    <text
      x={x + width + 8}
      y={y + height / 2}
      fill="#c4c7d8"
      fontSize={12}
      fontWeight={600}
      dominantBaseline="central"
    >
      {formatter ? formatter(value) : value.toLocaleString()}
    </text>
  );
}

// ── Component ────────────────────────────────────────────────────────

export function BarChartWrapper({
  data,
  layout = "vertical",
  tooltipFormatter,
  labelFormatter,
  height = 280,
  barSize = 28,
}: BarChartWrapperProps) {
  const isHorizontal = layout === "vertical"; // recharts naming is counterintuitive for horizontal bars

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 80, bottom: 4, left: 8 }}
        barCategoryGap="24%"
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(30,32,48,0.6)"
          horizontal={false}
        />

        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 13, fill: "#c4c7d8", fontWeight: 500 }}
          width={100}
        />

        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "#6b7094" }}
          tickFormatter={(v: number) =>
            tooltipFormatter ? tooltipFormatter(v) : v.toLocaleString()
          }
        />

        <Tooltip
          content={<CustomTooltip formatter={tooltipFormatter} />}
          cursor={{ fill: "rgba(99,102,241,0.06)" }}
        />

        <Bar
          dataKey="value"
          barSize={barSize}
          radius={[0, 6, 6, 0]}
          animationDuration={1200}
          animationEasing="ease-out"
        >
          {data.map((entry, idx) => (
            <Cell key={idx} fill={entry.color} fillOpacity={0.85} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            content={(props) =>
              renderCustomLabel({ ...props, formatter: labelFormatter } as {
                x?: number;
                y?: number;
                width?: number;
                height?: number;
                value?: number;
                formatter?: (v: number) => string;
              })
            }
          />
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
