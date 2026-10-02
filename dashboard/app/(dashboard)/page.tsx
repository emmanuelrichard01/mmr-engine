"use client";

import {
  Activity,
  ShieldAlert,
  AlertCircle,
  Zap,
  TrendingUp,
  ArrowRight,
  Clock,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

import { KPICard } from "@/components/kpi-card";
import { AreaChartWrapper } from "@/components/charts/area-chart";
import { DemoBanner, LiveIndicator } from "@/components/demo-banner";
import { EmptyState } from "@/components/empty-state";
import { PSPLogo } from "@/components/psp-logos";
import {
  useKPISummary,
  useDailySummaries,
  useDiscrepancies,
  usePSPHealth,
  useAPIStatus,
} from "@/lib/hooks";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { useState, useMemo } from "react";

// ── Status badge lookup ───────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  open:          "badge badge-critical",
  investigating: "badge badge-high",
  escalated:     "badge badge-medium",
  resolved:      "badge badge-low",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "var(--color-danger-500)",
  high:     "var(--color-warning-500)",
  medium:   "var(--color-primary-500)",
  low:      "var(--color-success-500)",
};

// ── Loading skeleton ──────────────────────────────────────────────────

function KPISkeleton() {
  return (
    <div className="card animate-shimmer flex flex-col gap-3" style={{ minHeight: 110 }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[var(--color-surface-200)]" />
          <div className="h-2.5 w-20 bg-[var(--color-surface-200)] rounded" />
        </div>
        <div className="w-14 h-6 bg-[var(--color-surface-200)] rounded" />
      </div>
      <div className="h-6 w-28 bg-[var(--color-surface-200)] rounded mt-1" />
      <div className="h-2 w-16 bg-[var(--color-surface-200)] rounded" />
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="toast">
      <CheckCircle2 className="w-4 h-4 text-[var(--color-success-400)] shrink-0" />
      <span>{message}</span>
      <button
        onClick={onClose}
        className="ml-auto text-[var(--color-surface-400)] hover:text-[var(--color-surface-200)] transition-colors leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function ExecutiveOverviewPage() {
  const apiStatus = useAPIStatus();
  const { data: kpi, isLoading: kpiLoading, isUsingDemoData, refetch: refetchKPI } = useKPISummary();
  const { data: summaries, refetch: refetchSummaries } = useDailySummaries();
  const { data: discrepancies, refetch: refetchDiscrepancies } = useDiscrepancies();
  const { data: pspHealth, refetch: refetchPSP } = usePSPHealth();
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Top 5 most urgent discrepancies
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const urgentDiscrepancies = useMemo(
    () =>
      [...(discrepancies || [])]
        .sort(
          (a, b) =>
            (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4) ||
            b.ageHours - a.ageHours
        )
        .slice(0, 5),
    [discrepancies]
  );

  // Match rate chart data
  const matchRateData = useMemo(
    () => (summaries || []).map((s) => ({ date: s.date, rate: s.matchRate })),
    [summaries]
  );

  // Week-over-week trend
  const recentAvg = useMemo(() => {
    const r = matchRateData.slice(-7).map((d) => d.rate);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  }, [matchRateData]);
  const olderAvg = useMemo(() => {
    const r = matchRateData.slice(-14, -7).map((d) => d.rate);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  }, [matchRateData]);
  const trendDelta = recentAvg - olderAvg;

  // PSP exposure
  const pspList = pspHealth || [];
  const maxUnmatchedRate = Math.max(...pspList.map((p) => 100 - p.matchRate), 1);

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Refetch all data sources
      refetchKPI();
      refetchSummaries();
      refetchDiscrepancies();
      refetchPSP();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/health/ready`
      );
      setToast(res.ok ? "All data refreshed ✓" : "Data refreshed — pipeline reports degraded status");
    } catch {
      setToast("Data refreshed from cache — live API unreachable");
    }
    setSyncing(false);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="space-y-6 pb-8">

      {/* ── Demo Banner — only when on demo data ── */}
      {isUsingDemoData && (
        <div className="animate-fade-in">
          <DemoBanner />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          ROW 0: Page header — compact, data-forward
          ═════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-display">Overview</h1>
          <p className="text-[12px] text-[var(--color-surface-400)] font-medium mt-0.5">
            {new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Live / demo indicator */}
          <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-[var(--color-surface-200)] bg-[var(--color-surface-50)] text-[12px]">
            <LiveIndicator isConnected={apiStatus} />
          </div>

          {/* Sync */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn btn-primary flex items-center gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} strokeWidth={2.5} />
            <span>{syncing ? "Syncing..." : "Sync"}</span>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 1: KPI Cards — immediate business answers
          ═════════════════════════════════════════════════════════ */}
      <div
        data-tour="kpi-cards"
        className="grid grid-cols-2 xl:grid-cols-4 gap-4"
      >
        {kpiLoading || !kpi ? (
          <>
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
          </>
        ) : (
          <>
            <KPICard
              title="Match Rate"
              value={formatPercent(kpi.matchRate.value)}
              delta={kpi.matchRate.delta}
              trend={kpi.matchRate.trend}
              color="emerald"
              icon={<Activity strokeWidth={2.5} />}
              index={0}
            />
            <KPICard
              title="Open Exposure"
              value={formatCurrency(kpi.openExposure.value)}
              delta={kpi.openExposure.delta}
              deltaLabel="vs yesterday"
              trend={kpi.openExposure.trend}
              color="rose"
              icon={<ShieldAlert strokeWidth={2.5} />}
              index={1}
              invertDelta
            />
            <KPICard
              title="Pending Issues"
              value={String(kpi.pendingIssues.value)}
              delta={kpi.pendingIssues.delta}
              trend={kpi.pendingIssues.trend}
              color="amber"
              icon={<AlertCircle strokeWidth={2.5} />}
              index={2}
              invertDelta
            />
            <KPICard
              title="Txns Today"
              value={kpi.txnsToday.value.toLocaleString()}
              delta={kpi.txnsToday.delta}
              trend={kpi.txnsToday.trend}
              color="indigo"
              icon={<Zap strokeWidth={2.5} />}
              index={3}
            />
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2: Charts
          ═════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Match Rate Trend — 2/3 width */}
        <div
          data-tour="match-trend"
          className="card lg:col-span-2 animate-fade-in"
          style={{ animationDelay: "0.18s" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--color-surface-900)] tracking-tight">
                Match Rate Trend
              </h2>
              <p className="text-[11px] text-[var(--color-surface-400)] font-medium mt-0.5">
                30-day reconciliation accuracy
              </p>
            </div>
            <div className={cn(
              "flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border",
              trendDelta >= 0
                ? "text-[var(--color-success-600)] bg-[var(--color-success-50)] border-[var(--color-success-100)]"
                : "text-[var(--color-danger-600)] bg-[var(--color-danger-50)] border-[var(--color-danger-100)]"
            )}>
              <TrendingUp className="w-3 h-3" strokeWidth={2.5} />
              {trendDelta >= 0 ? "+" : ""}{trendDelta.toFixed(1)}% week
            </div>
          </div>
          <AreaChartWrapper
            data={matchRateData}
            dataKey="rate"
            xKey="date"
            color="var(--color-primary-500)"
            gradientId="matchrate-gradient"
            yDomain={[90, 100]}
            tooltipFormatter={(v) => formatPercent(v)}
            xTickFormatter={(d) => {
              const date = new Date(d);
              return `${date.getDate()}/${date.getMonth() + 1}`;
            }}
            height={240}
          />
        </div>

        {/* Exposure by PSP — 1/3 width */}
        <div
          data-tour="exposure-chart"
          className="card animate-fade-in"
          style={{ animationDelay: "0.24s" }}
        >
          <div className="mb-5">
            <h2 className="text-[14px] font-semibold text-[var(--color-surface-900)] tracking-tight">
              Exposure by PSP
            </h2>
            <p className="text-[11px] text-[var(--color-surface-400)] font-medium mt-0.5">
              Unmatched volume per processor
            </p>
          </div>

          <div className="space-y-5">
            {pspList.length === 0 ? (
              <EmptyState
                title="No PSP data"
                description="Connect payment processors to see exposure breakdown."
              />
            ) : (
              pspList.map((p) => {
                const unmatchedRate = 100 - p.matchRate;
                const unmatchedVolume = p.volumeToday * (unmatchedRate / 100);
                const pct = (unmatchedRate / maxUnmatchedRate) * 100;
                return (
                  <div key={p.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PSPLogo name={p.name} iconOnly className="w-4 h-4 shrink-0" />
                        <span className="text-[12px] font-semibold text-[var(--color-surface-800)] capitalize">
                          {p.displayName}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12px] font-bold text-[var(--color-surface-900)] tabular-nums">
                          {formatCurrency(unmatchedVolume, true)}
                        </span>
                        <span className="text-[11px] text-[var(--color-surface-400)] tabular-nums w-8 text-right">
                          {unmatchedRate.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    {/* Progress bar — PSP-specific color */}
                    <div className="h-[5px] bg-[var(--color-surface-100)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${Math.min(100, Math.max(3, pct))}%`,
                          background:
                            p.name === 'paystack' ? 'var(--color-primary-500)' :
                            p.name === 'flutterwave' ? 'var(--color-success-500)' :
                            p.name === 'mpesa' ? 'var(--color-warning-500)' :
                            'var(--color-surface-500)',
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 3: Discrepancies — "What needs attention?"
          Full width — Quick Actions panel removed (dead code).
          ═════════════════════════════════════════════════════════ */}
      <div
        data-tour="recent-discrepancies"
        className="card animate-fade-in overflow-hidden"
        style={{ animationDelay: "0.3s" }}
      >
        {/* Section header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--color-surface-100)]">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--color-surface-900)] tracking-tight">
              Needs Attention
            </h2>
            <p className="text-[11px] text-[var(--color-surface-400)] font-medium mt-0.5">
              Top 5 open discrepancies by severity and age
            </p>
          </div>
          <a
            href="/discrepancies"
            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--color-surface-500)] hover:text-[var(--color-surface-900)] transition-colors group"
          >
            View all
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </a>
        </div>

        {urgentDiscrepancies.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="All clear"
              description="No open discrepancies — all transactions are matched."
            />
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr className="border-b border-[var(--color-surface-100)]">
                  <th className="table-header pl-5">Discrepancy</th>
                  <th className="table-header">PSP</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Age</th>
                  <th className="table-header pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {urgentDiscrepancies.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-[var(--color-surface-100)] last:border-0 hover:bg-[var(--color-surface-50)] transition-colors cursor-pointer group"
                    onClick={() => (window.location.href = `/discrepancies?id=${d.id}`)}
                  >
                    {/* Severity dot + type */}
                    <td className="py-3 pl-5 pr-4">
                      <div className="flex items-center gap-2.5">
                        {/* Severity dot */}
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: SEVERITY_DOT[d.severity] ?? "var(--color-surface-300)" }}
                        />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[var(--color-surface-900)] group-hover:text-[var(--color-primary-600)] transition-colors truncate">
                            {d.type.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                          </p>
                          <p className="text-mono text-[var(--color-surface-400)] mt-0.5 truncate">
                            {d.reference}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* PSP */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <PSPLogo name={d.psp} iconOnly className="w-4 h-4 shrink-0" />
                        <span className="text-[12px] font-medium text-[var(--color-surface-600)] capitalize">
                          {d.psp}
                        </span>
                      </div>
                    </td>
                    {/* Amount */}
                    <td className="py-3 px-4 text-right">
                      <span className="text-[13px] font-bold text-[var(--color-surface-900)] tabular-nums">
                        {formatCurrency(d.amount)}
                      </span>
                    </td>
                    {/* Status badge */}
                    <td className="py-3 px-4">
                      <span className={STATUS_BADGE[d.status] ?? "badge badge-neutral"}>
                        {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                      </span>
                    </td>
                    {/* Age */}
                    <td className="py-3 pl-4 pr-5">
                      <div className="flex items-center gap-1 text-[11px] text-[var(--color-surface-400)] font-medium">
                        <Clock className="w-3 h-3" strokeWidth={2} />
                        {d.ageHours < 24
                          ? `${d.ageHours}h`
                          : `${Math.floor(d.ageHours / 24)}d`}
                      </div>
                    </td>
                    {/* Arrow */}
                    <td className="py-3 pr-5 w-4">
                      <ChevronRight className="w-4 h-4 text-[var(--color-surface-300)] group-hover:text-[var(--color-surface-500)] transition-colors" strokeWidth={2} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
