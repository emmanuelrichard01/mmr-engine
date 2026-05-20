"use client";

import {
  Activity,
  ShieldAlert,
  AlertCircle,
  Zap,
  TrendingUp,
  ArrowRight,
  Clock,
} from "lucide-react";

import { KPICard } from "@/components/kpi-card";
import { AreaChartWrapper } from "@/components/charts/area-chart";
import { BarChartWrapper } from "@/components/charts/bar-chart";
import { DemoBanner, LiveIndicator } from "@/components/demo-banner";
import {
  useKPISummary,
  useDailySummaries,
  useDiscrepancies,
  usePSPHealth,
  useAPIStatus,
} from "@/lib/hooks";
import { formatCurrency, formatPercent, timeAgo } from "@/lib/utils";

// ── Severity color helper ────────────────────────────────────────────

const severityColors: Record<string, string> = {
  critical: "#f43f5e",
  high: "#f59e0b",
  medium: "#6366f1",
  low: "#10b981",
};

const severityClasses: Record<string, string> = {
  critical: "badge badge-critical",
  high: "badge badge-high",
  medium: "badge badge-medium",
  low: "badge badge-low",
};

const statusClasses: Record<string, string> = {
  open: "text-danger-400",
  investigating: "text-warning-400",
  escalated: "text-primary-400",
  resolved: "text-success-400",
};

const pspIcons: Record<string, string> = {
  paystack: "🟢",
  flutterwave: "🟡",
  mpesa: "🔵",
};

// ── Loading skeleton ─────────────────────────────────────────────────

function KPISkeleton() {
  return (
    <div className="card border-l-4 border-l-surface-300 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="h-4 w-24 bg-surface-200 rounded" />
          <div className="h-8 w-32 bg-surface-200 rounded" />
          <div className="h-3 w-20 bg-surface-200 rounded" />
        </div>
        <div className="w-24 h-14 bg-surface-200 rounded" />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function ExecutiveOverviewPage() {
  const apiStatus = useAPIStatus();
  const { data: kpi, isLoading: kpiLoading, isUsingDemoData } = useKPISummary();
  const { data: summaries } = useDailySummaries();
  const { data: discrepancies } = useDiscrepancies();
  const { data: pspHealth } = usePSPHealth();

  // Top 5 most urgent discrepancies (by severity, then recency)
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const urgentDiscrepancies = [...(discrepancies || [])]
    .sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4) ||
        b.ageHours - a.ageHours
    )
    .slice(0, 5);

  // Chart data
  const matchRateData = (summaries || []).map((s) => ({
    date: s.date,
    rate: s.matchRate,
  }));

  // Exposure bar data from PSP health
  const pspColors: Record<string, string> = {
    paystack: "#6366f1",
    flutterwave: "#10b981",
    mpesa: "#f59e0b",
  };
  const exposureBarData = (pspHealth || []).map((p) => ({
    name: p.displayName,
    value: p.volumeToday * (1 - p.matchRate / 100), // Estimated unmatched exposure
    color: pspColors[p.name] || "#6366f1",
  }));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── Demo Banner ── */}
      {isUsingDemoData && <DemoBanner />}

      {/* ── Page Header ── */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: "0s" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">
              Executive Overview
            </h1>
            <p className="text-sm text-surface-500 mt-0.5">
              Real-time reconciliation health across all payment processors
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <LiveIndicator isConnected={apiStatus} />
            <span className="text-surface-400">|</span>
            <Clock className="w-3.5 h-3.5" />
            <span>
              {new Date().toLocaleDateString("en-NG", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════ ROW 1: KPI Cards ═══════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
              icon={<Activity className="w-4 h-4" />}
              index={0}
            />
            <KPICard
              title="Open Exposure"
              value={formatCurrency(kpi.openExposure.value)}
              delta={kpi.openExposure.delta}
              deltaLabel="vs yesterday"
              trend={kpi.openExposure.trend}
              color="rose"
              icon={<ShieldAlert className="w-4 h-4" />}
              index={1}
            />
            <KPICard
              title="Pending Issues"
              value={String(kpi.pendingIssues.value)}
              delta={kpi.pendingIssues.delta}
              trend={kpi.pendingIssues.trend}
              color="amber"
              icon={<AlertCircle className="w-4 h-4" />}
              index={2}
            />
            <KPICard
              title="Txns Today"
              value={kpi.txnsToday.value.toLocaleString()}
              delta={kpi.txnsToday.delta}
              trend={kpi.txnsToday.trend}
              color="indigo"
              icon={<Zap className="w-4 h-4" />}
              index={3}
            />
          </>
        )}
      </div>

      {/* ═══════════════ ROW 2: Charts ═══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Match Rate Trend */}
        <div
          className="card animate-fade-in"
          style={{ animationDelay: "0.5s" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-surface-800">
                Match Rate Trend
              </h2>
              <p className="text-xs text-surface-500 mt-0.5">
                Last 30 days — daily reconciliation accuracy
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <TrendingUp className="w-3.5 h-3.5 text-success-400" />
              <span className="text-success-400 font-medium">
                +1.2% this month
              </span>
            </div>
          </div>
          <AreaChartWrapper
            data={matchRateData}
            dataKey="rate"
            xKey="date"
            color="#818cf8"
            gradientId="matchrate-gradient"
            yDomain={[90, 100]}
            tooltipFormatter={(v) => formatPercent(v)}
            xTickFormatter={(d) => {
              const date = new Date(d);
              return `${date.getDate()}/${date.getMonth() + 1}`;
            }}
            height={260}
          />
        </div>

        {/* Exposure by PSP */}
        <div
          className="card animate-fade-in"
          style={{ animationDelay: "0.6s" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-surface-800">
                Exposure by PSP
              </h2>
              <p className="text-xs text-surface-500 mt-0.5">
                Outstanding unreconciled amounts per processor
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-surface-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#6366f1] inline-block" />
                Paystack
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#10b981] inline-block" />
                Flutterwave
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#f59e0b] inline-block" />
                M-Pesa
              </span>
            </div>
          </div>
          <BarChartWrapper
            data={exposureBarData}
            tooltipFormatter={(v) => formatCurrency(v)}
            labelFormatter={(v) => formatCurrency(v)}
            height={260}
          />
        </div>
      </div>

      {/* ═══════════════ ROW 3: Recent Discrepancies ═══════════════ */}
      <div
        className="card animate-fade-in"
        style={{ animationDelay: "0.7s" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-surface-800">
              Recent Discrepancies
            </h2>
            <p className="text-xs text-surface-500 mt-0.5">
              Top 5 most urgent items requiring attention
            </p>
          </div>
          <a
            href="/discrepancies"
            className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 font-medium transition-colors group"
          >
            View all
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>

        {/* Table */}
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200">
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Severity
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  PSP
                </th>
                <th className="text-right text-xs font-medium text-surface-500 pb-3 pr-4">
                  Amount
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Age
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {urgentDiscrepancies.map((d, i) => (
                <tr
                  key={d.id}
                  className="border-b border-surface-200/50 last:border-0 hover:bg-surface-100/50 transition-colors cursor-pointer group animate-fade-in"
                  style={{ animationDelay: `${0.8 + i * 0.05}s` }}
                >
                  {/* Severity */}
                  <td className="py-3 pr-4">
                    <span className={severityClasses[d.severity]}>
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ backgroundColor: severityColors[d.severity] }}
                      />
                      {d.severity.charAt(0).toUpperCase() +
                        d.severity.slice(1)}
                    </span>
                  </td>

                  {/* Type */}
                  <td className="py-3 pr-4">
                    <span className="text-surface-700 font-medium">
                      {d.type
                        .split("_")
                        .map(
                          (w) =>
                            w.charAt(0).toUpperCase() + w.slice(1)
                        )
                        .join(" ")}
                    </span>
                    <p className="text-xs text-surface-500 mt-0.5 max-w-[220px] truncate">
                      {d.reference}
                    </p>
                  </td>

                  {/* PSP */}
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm">{pspIcons[d.psp] || "⚡"}</span>
                      <span className="text-surface-600 text-xs font-medium capitalize">
                        {d.psp}
                      </span>
                    </span>
                  </td>

                  {/* Amount */}
                  <td className="py-3 pr-4 text-right font-semibold text-surface-800 tabular-nums">
                    {formatCurrency(d.amount)}
                  </td>

                  {/* Age */}
                  <td className="py-3 pr-4">
                    <span className="text-xs text-surface-500">
                      {d.ageHours < 1
                        ? "just now"
                        : d.ageHours < 24
                        ? `${Math.round(d.ageHours)}h ago`
                        : `${Math.round(d.ageHours / 24)}d ago`}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-3">
                    <span
                      className={`text-xs font-medium capitalize ${
                        statusClasses[d.status] || "text-surface-500"
                      }`}
                    >
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
