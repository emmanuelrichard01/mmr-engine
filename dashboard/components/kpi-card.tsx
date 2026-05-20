"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

// ── Color map ────────────────────────────────────────────────────────

const colorMap = {
  indigo: {
    border: "border-l-primary-500",
    sparkFill: "rgba(99,102,241,0.20)",
    sparkStroke: "#818cf8",
    deltaBg: "",
  },
  emerald: {
    border: "border-l-success-500",
    sparkFill: "rgba(16,185,129,0.20)",
    sparkStroke: "#34d399",
    deltaBg: "",
  },
  amber: {
    border: "border-l-warning-500",
    sparkFill: "rgba(245,158,11,0.20)",
    sparkStroke: "#fbbf24",
    deltaBg: "",
  },
  rose: {
    border: "border-l-danger-500",
    sparkFill: "rgba(244,63,94,0.20)",
    sparkStroke: "#fb7185",
    deltaBg: "",
  },
} as const;

export type KPIColor = keyof typeof colorMap;

// ── Props ────────────────────────────────────────────────────────────

export interface KPICardProps {
  title: string;
  value: string;
  delta: number;
  deltaLabel?: string;
  trend: number[];
  color: KPIColor;
  icon: ReactNode;
  index?: number; // for staggered animation
}

// ── Component ────────────────────────────────────────────────────────

export function KPICard({
  title,
  value,
  delta,
  deltaLabel = "vs yesterday",
  trend,
  color,
  icon,
  index = 0,
}: KPICardProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const palette = colorMap[color];
  const isPositive = delta > 0;
  const isNeutral = delta === 0;

  // For "open exposure" & "pending issues", negative delta is GOOD
  const isGoodDelta =
    title === "Open Exposure" || title === "Pending Issues"
      ? delta < 0
      : delta > 0;

  const sparkData = trend.map((v, i) => ({ v, i }));

  return (
    <div
      className={cn(
        "card border-l-4 relative overflow-hidden group",
        palette.border,
        mounted ? "animate-fade-in" : "opacity-0"
      )}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Glassmorphism shimmer on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      <div className="flex items-start justify-between gap-4">
        {/* Text content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-surface-500 shrink-0">{icon}</span>
            <p className="text-sm font-medium text-surface-500 truncate">
              {title}
            </p>
          </div>

          <p className="text-3xl font-bold text-surface-900 tracking-tight">
            {value}
          </p>

          {/* Delta badge */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md",
                isNeutral
                  ? "text-surface-500 bg-surface-200"
                  : isGoodDelta
                  ? "text-success-400 bg-success-500/15"
                  : "text-danger-400 bg-danger-500/15"
              )}
            >
              {isNeutral ? (
                <Minus className="w-3 h-3" />
              ) : isPositive ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              {Math.abs(delta)}
              {title === "Match Rate" || title === "Txns Today" ? "%" : ""}
            </span>
            <span className="text-xs text-surface-500">{deltaLabel}</span>
          </div>
        </div>

        {/* Sparkline */}
        <div className="w-24 h-14 shrink-0 -mr-1 -mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.sparkStroke} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={palette.sparkStroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={["dataMin", "dataMax"]} hide />
              <Area
                type="monotone"
                dataKey="v"
                stroke={palette.sparkStroke}
                strokeWidth={2}
                fill={`url(#spark-${color})`}
                dot={false}
                isAnimationActive={mounted}
                animationDuration={1200}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
