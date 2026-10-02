"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

// ── Color system (CSS-variable-based, auto dark mode) ─────────────────

const colorMap = {
  indigo: {
    iconBg: "color-mix(in srgb, #6366f1 10%, transparent)",
    iconColor: "#4f46e5",
    spark: "#6366f1",
    accent: "var(--color-primary-500)",
  },
  emerald: {
    iconBg: "color-mix(in srgb, #10b981 10%, transparent)",
    iconColor: "#059669",
    spark: "#10b981",
    accent: "var(--color-success-500)",
  },
  amber: {
    iconBg: "color-mix(in srgb, #f59e0b 10%, transparent)",
    iconColor: "#d97706",
    spark: "#f59e0b",
    accent: "var(--color-warning-500)",
  },
  rose: {
    iconBg: "color-mix(in srgb, #f43f5e 10%, transparent)",
    iconColor: "#e11d48",
    spark: "#f43f5e",
    accent: "var(--color-danger-500)",
  },
} as const;

export type KPIColor = keyof typeof colorMap;

// ── Sparkline ─────────────────────────────────────────────────────────

function Sparkline({
  data,
  color,
  uniqueId,
  width = 64,
  height = 28,
}: {
  data: number[];
  color: string;
  uniqueId: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = 2;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const fillPts = [`0,${height}`, ...pts, `${width},${height}`].join(" ");
  const gradId = `spark-${uniqueId}`;

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#${gradId})`} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      {/* Terminal dot */}
      {(() => {
        const last = pts[pts.length - 1].split(",");
        return (
          <circle
            cx={parseFloat(last[0])}
            cy={parseFloat(last[1])}
            r="2.5"
            fill={color}
          />
        );
      })()}
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────

export interface KPICardProps {
  title: string;
  value: string;
  delta: number;
  deltaLabel?: string;
  trend: number[];
  color: KPIColor;
  icon: ReactNode;
  index?: number;
  /** Hint to the delta logic — risk/cost metrics where lower is better */
  invertDelta?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────

export function KPICard({
  title,
  value,
  delta,
  deltaLabel = "vs yesterday",
  trend,
  color,
  icon,
  index = 0,
  invertDelta,
}: KPICardProps) {
  const [mounted, setMounted] = useState(false);
  const uid = useId(); // Stable, unique — no SVG gradient ID collision
  useEffect(() => setMounted(true), []);

  const palette = colorMap[color];

  const isNeutral = delta === 0;
  const isPositive = delta > 0;

  // Lower is better for cost/risk metrics
  const lowerIsBetter =
    invertDelta ?? (title === "Open Exposure" || title === "Pending Issues");

  const isGood = isNeutral
    ? false
    : lowerIsBetter
    ? delta < 0   // lower is good
    : delta > 0;  // higher is good

  return (
    <div
      className={cn(
        // No hover-lift translateY — financial data doesn't bounce
        "card relative overflow-hidden flex flex-col gap-3",
        mounted ? "animate-fade-in" : "opacity-0"
      )}
      style={{ animationDelay: `${index * 0.06}s` }}
    >
      {/* ── Header: icon + label + sparkline ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Icon */}
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ background: palette.iconBg }}
          >
            <span
              className="[&>svg]:w-3.5 [&>svg]:h-3.5"
              style={{ color: palette.iconColor }}
            >
              {icon}
            </span>
          </div>

          {/* Label */}
          <p className="text-[12px] font-medium text-[var(--color-surface-500)] leading-none">
            {title}
          </p>
        </div>

        {/* Sparkline — right-aligned, subtle */}
        <Sparkline
          data={trend}
          color={palette.spark}
          uniqueId={uid}
          width={56}
          height={24}
        />
      </div>

      {/* ── Value ── */}
      <div>
        <p
          className="text-[26px] font-bold tracking-tight text-[var(--color-surface-900)] leading-none"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </p>

        {/* ── Delta ── */}
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold",
              isNeutral
                ? "text-[var(--color-surface-400)]"
                : isGood
                ? "text-[var(--color-success-600)]"
                : "text-[var(--color-danger-500)]"
            )}
          >
            {isNeutral ? (
              <Minus className="w-3 h-3" />
            ) : isPositive ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : (
              <ArrowDownRight className="w-3 h-3" />
            )}
            <span>
              {Math.abs(delta)}
              {title === "Match Rate" ? "%" : ""}
            </span>
          </span>
          <span className="text-[11px] text-[var(--color-surface-400)]">
            {deltaLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
