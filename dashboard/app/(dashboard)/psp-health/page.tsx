'use client';

import { usePSPHealth, useAPIStatus } from '@/lib/hooks';
import { DemoBanner } from '@/components/demo-banner';
import { formatCurrency, formatPercent, getRelativeTime, cn } from '@/lib/utils';
import {
  Wifi, WifiOff, AlertTriangle, Clock, TrendingUp,
  ArrowDownRight, Activity, Zap, BarChart3
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const PSP_COLORS: Record<string, string> = {
  paystack: '#6366f1',
  flutterwave: '#10b981',
  mpesa: '#f59e0b',
};

const PSP_ICONS: Record<string, string> = {
  paystack: '💳',
  flutterwave: '🦋',
  mpesa: '📱',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof Wifi }> = {
  connected:    { bg: 'bg-[var(--color-success-500)]/15', text: 'text-[var(--color-success-400)]', icon: Wifi },
  degraded:     { bg: 'bg-[var(--color-warning-500)]/15', text: 'text-[var(--color-warning-400)]', icon: AlertTriangle },
  disconnected: { bg: 'bg-[var(--color-surface-400)]/15',  text: 'text-[var(--color-surface-500)]', icon: WifiOff },
};

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
  const timelineData = generateSettlementTimeline();

  return (
    <div className="space-y-6">
      {/* Demo Banner */}
      {isUsingDemoData && <DemoBanner />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-surface-900)]">PSP Health</h1>
        <p className="text-sm text-[var(--color-surface-500)] mt-1">
          Real-time monitoring of payment service provider integrations
        </p>
      </div>

      {/* PSP Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {allPSPs.map((psp, idx) => {
          const style = STATUS_STYLES[psp.status] || STATUS_STYLES.disconnected;
          const StatusIcon = style.icon;
          const borderColor = psp.status === 'connected' ? 'border-l-[var(--color-success-500)]' :
                              psp.status === 'degraded' ? 'border-l-[var(--color-warning-500)]' :
                              'border-l-[var(--color-surface-400)]';

          return (
            <div
              key={psp.name}
              className={cn('card border-l-4 animate-fade-in', borderColor)}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              {/* PSP Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{PSP_ICONS[psp.name] || '⚡'}</span>
                  <div>
                    <h3 className="font-semibold text-[var(--color-surface-900)]">{psp.displayName}</h3>
                    <p className="text-xs text-[var(--color-surface-500)]">
                      Last webhook: {getRelativeTime(psp.lastWebhookAt)}
                    </p>
                  </div>
                </div>
                <span className={cn('badge flex items-center gap-1.5', style.bg, style.text)}>
                  <StatusIcon className="w-3 h-3" />
                  {psp.status}
                </span>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--color-surface-100)] rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-500)] mb-1">
                    <BarChart3 className="w-3 h-3" />
                    <span className="text-xs">Volume Today</span>
                  </div>
                  <p className="text-lg font-bold text-[var(--color-surface-900)]">
                    {formatCurrency(psp.volumeToday)}
                  </p>
                </div>
                <div className="bg-[var(--color-surface-100)] rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-500)] mb-1">
                    <TrendingUp className="w-3 h-3" />
                    <span className="text-xs">Match Rate</span>
                  </div>
                  <p className={cn(
                    'text-lg font-bold',
                    psp.matchRate >= 99 ? 'text-[var(--color-success-400)]' :
                    psp.matchRate >= 95 ? 'text-[var(--color-warning-400)]' :
                    'text-[var(--color-danger-400)]'
                  )}>
                    {formatPercent(psp.matchRate)}
                  </p>
                </div>
                <div className="bg-[var(--color-surface-100)] rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-500)] mb-1">
                    <Clock className="w-3 h-3" />
                    <span className="text-xs">Avg Settlement</span>
                  </div>
                  <p className="text-lg font-bold text-[var(--color-surface-900)]">
                    {psp.avgSettlementHours}h
                  </p>
                </div>
                <div className="bg-[var(--color-surface-100)] rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[var(--color-surface-500)] mb-1">
                    <Activity className="w-3 h-3" />
                    <span className="text-xs">Webhook Gap</span>
                  </div>
                  <p className={cn(
                    'text-lg font-bold',
                    psp.webhookGapRate < 1 ? 'text-[var(--color-success-400)]' :
                    psp.webhookGapRate < 3 ? 'text-[var(--color-warning-400)]' :
                    'text-[var(--color-danger-400)]'
                  )}>
                    {formatPercent(psp.webhookGapRate)}
                  </p>
                </div>
              </div>

              {/* Transactions count */}
              <div className="mt-3 pt-3 border-t border-[var(--color-surface-200)] flex items-center justify-between text-xs text-[var(--color-surface-500)]">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {psp.transactionsToday.toLocaleString()} transactions today
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Settlement Timeline Chart */}
      <div className="card animate-fade-in" style={{ animationDelay: '0.4s' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-[var(--color-surface-900)]">Settlement Timeline (24h)</h3>
            <p className="text-xs text-[var(--color-surface-500)] mt-0.5">
              Transactions processed per hour by PSP
            </p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timelineData}>
              <defs>
                {Object.entries(PSP_COLORS).map(([name, color]) => (
                  <linearGradient key={name} id={`gradient-${name}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-surface-200)"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="hour"
                tick={{ fill: 'var(--color-surface-500)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={3}
              />
              <YAxis
                tick={{ fill: 'var(--color-surface-500)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface-100)',
                  border: '1px solid var(--color-surface-300)',
                  borderRadius: '8px',
                  color: 'var(--color-surface-800)',
                  fontSize: '12px',
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: '12px', color: 'var(--color-surface-600)' }}
              />
              {Object.entries(PSP_COLORS).map(([name, color]) => (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name.charAt(0).toUpperCase() + name.slice(1)}
                  stroke={color}
                  fill={`url(#gradient-${name})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
