'use client';

import { useMemo } from 'react';
import { usePSPHealth, useAPIStatus } from '@/lib/hooks';
import { DemoBanner } from '@/components/demo-banner';
import { formatCurrency, formatPercent, getRelativeTime, cn } from '@/lib/utils';
import { PSPLogo } from '@/components/psp-logos';
import {
  Wifi, WifiOff, AlertTriangle, Clock, TrendingUp,
  ArrowDownRight, Activity, Zap, BarChart3
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const PSP_COLORS: Record<string, string> = {
  paystack: '#2563eb', // Royal Blue
  flutterwave: '#10b981', // Emerald
  mpesa: '#f59e0b', // Amber
};

const STATUS_STYLES: Record<string, { className: string; icon: typeof Wifi }> = {
  connected:    { className: 'bg-[var(--color-success-50)] text-[var(--color-success-600)] border border-[var(--color-success-100)]', icon: Wifi },
  degraded:     { className: 'bg-[var(--color-warning-50)] text-[var(--color-warning-600)] border border-[var(--color-warning-100)]', icon: AlertTriangle },
  disconnected: { className: 'bg-[var(--color-surface-100)] text-[var(--color-surface-500)] border border-[var(--color-surface-200)]', icon: WifiOff },
};

// Custom Tooltip for multiple area lines
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[var(--color-surface-50)] border border-[var(--color-surface-200)] rounded-lg p-3 shadow-lg space-y-2">
      <p className="text-[10px] font-semibold text-[var(--color-surface-400)] uppercase tracking-wider">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-[var(--color-surface-500)] font-medium">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <span className="font-bold text-[var(--color-surface-800)]">{item.value.toLocaleString()} txns</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mock 24h settlement timeline data
function generateSettlementTimeline() {
  const hours = Array.from({ length: 24 }, (_, i) => {
    const h = i.toString().padStart(2, '0') + ':00';
    return {
      hour: h,
      paystack: Math.floor(30 + Math.random() * 70 * Math.sin((i / 24) * Math.PI)),
      flutterwave: Math.floor(20 + Math.random() * 50 * Math.sin((i / 24) * Math.PI)),
      mpesa: Math.floor(10 + Math.random() * 30 * Math.sin((i / 24) * Math.PI)),
    };
  });
  return hours;
}

export default function PSPHealthPage() {
  const { data: pspHealth, isUsingDemoData } = usePSPHealth();
  const allPSPs = pspHealth || [];
  const timelineData = useMemo(() => generateSettlementTimeline(), []);

  return (
    <div className="space-y-5 pb-8">
      {/* Demo Banner */}
      {isUsingDemoData && <DemoBanner />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display">PSP Health</h1>
          <p className="text-[12px] text-[var(--color-surface-400)] font-medium mt-0.5">
            Real-time payment processor monitoring
          </p>
        </div>
      </div>

      {/* PSP Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {allPSPs.map((psp, idx) => {
          const style = STATUS_STYLES[psp.status] || STATUS_STYLES.disconnected;
          const StatusIcon = style.icon;

          return (
            <div
              key={psp.name}
              className="card animate-fade-in"
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              {/* PSP Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] flex items-center justify-center shrink-0">
                    <PSPLogo name={psp.name} iconOnly className="w-5 h-5 shrink-0" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-surface-900)] text-[13px] leading-tight">{psp.displayName}</h3>
                    <p className="text-[11px] text-[var(--color-surface-400)] font-medium mt-0.5">
                      Last webhook: {getRelativeTime(psp.lastWebhookAt)}
                    </p>
                  </div>
                </div>
                <span className={cn(
                  'badge',
                  psp.status === 'connected'    ? 'badge-connected'    :
                  psp.status === 'degraded'     ? 'badge-high'         :
                  'badge-disconnected'
                )}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  <span className="capitalize">{psp.status}</span>
                </span>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-[var(--color-surface-100)]/60 border border-[var(--color-surface-200)]/60 rounded-lg p-3.5">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-400)] font-semibold text-[10px] uppercase tracking-wider mb-1">
                    <BarChart3 className="w-3.5 h-3.5 text-[var(--color-surface-400)]" />
                    <span>Volume Today</span>
                  </div>
                  <p className="text-lg font-extrabold text-[var(--color-surface-800)]">
                    {formatCurrency(psp.volumeToday)}
                  </p>
                </div>
                <div className="bg-[var(--color-surface-100)]/60 border border-[var(--color-surface-200)]/60 rounded-lg p-3.5">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-400)] font-semibold text-[10px] uppercase tracking-wider mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-[var(--color-surface-400)]" />
                    <span>Match Rate</span>
                  </div>
                  <p className={cn(
                    'text-lg font-extrabold',
                    psp.matchRate >= 99 ? 'text-[var(--color-success-600)]' :
                    psp.matchRate >= 95 ? 'text-[var(--color-warning-600)]' :
                    'text-[var(--color-danger-600)]'
                  )}>
                    {formatPercent(psp.matchRate)}
                  </p>
                </div>
                <div className="bg-[var(--color-surface-100)]/60 border border-[var(--color-surface-200)]/60 rounded-lg p-3.5">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-400)] font-semibold text-[10px] uppercase tracking-wider mb-1">
                    <Clock className="w-3.5 h-3.5 text-[var(--color-surface-400)]" />
                    <span>Avg Settlement</span>
                  </div>
                  <p className="text-lg font-extrabold text-[var(--color-surface-800)]">
                    {psp.avgSettlementHours}h
                  </p>
                </div>
                <div className="bg-[var(--color-surface-100)]/60 border border-[var(--color-surface-200)]/60 rounded-lg p-3.5">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-400)] font-semibold text-[10px] uppercase tracking-wider mb-1">
                    <Activity className="w-3.5 h-3.5 text-[var(--color-surface-400)]" />
                    <span>Webhook Gap</span>
                  </div>
                  <p className={cn(
                    'text-lg font-extrabold',
                    psp.webhookGapRate < 1 ? 'text-[var(--color-success-600)]' :
                    psp.webhookGapRate < 3 ? 'text-[var(--color-warning-600)]' :
                    'text-[var(--color-danger-600)]'
                  )}>
                    {formatPercent(psp.webhookGapRate)}
                  </p>
                </div>
              </div>

              {/* Transactions count */}
              <div className="mt-4 pt-3 border-t border-[var(--color-surface-200)]/60 flex items-center justify-between text-[11px] text-[var(--color-surface-400)] font-medium">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>{psp.transactionsToday.toLocaleString()} transactions today</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Settlement Timeline Chart */}
      <div className="card animate-fade-in" style={{ animationDelay: '0.4s' }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-bold text-[var(--color-surface-800)] text-base">Settlement Timeline (24h)</h3>
            <p className="text-xs text-[var(--color-surface-400)] mt-1 font-medium">
              Transactions processed per hour by PSP
            </p>
          </div>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timelineData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                {Object.entries(PSP_COLORS).map(([name, color]) => (
                  <linearGradient key={name} id={`gradient-${name}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-surface-200)"
                vertical={false}
              />
              <XAxis
                dataKey="hour"
                tick={{ fill: 'var(--color-surface-400)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                dy={8}
                interval={3}
              />
              <YAxis
                tick={{ fill: 'var(--color-surface-400)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                dx={-4}
                width={40}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: "var(--color-primary-500)",
                  strokeOpacity: 0.15,
                  strokeWidth: 1.5,
                  strokeDasharray: "4 4",
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: '11px', color: 'var(--color-surface-500)', fontWeight: 500, paddingBottom: '20px' }}
              />
              {Object.entries(PSP_COLORS).map(([name, color]) => (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name.charAt(0).toUpperCase() + name.slice(1)}
                  stroke={color}
                  fill={`url(#gradient-${name})`}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{
                    r: 4.5,
                    stroke: color,
                    strokeWidth: 2,
                    fill: "var(--color-surface-50)",
                  }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
