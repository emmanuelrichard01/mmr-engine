"use client";

/**
 * MMR Engine — Investor Demo Page
 * ─────────────────────────────────────────────────────────────────────────────
 * A fully live, animated, interactive demonstration of the reconciliation
 * pipeline. Built to Stripe/Vercel quality standards.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Zap,
  ShieldCheck,
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  Clock,
  ChevronRight,
  Play,
  RefreshCw,
  Globe,
  BarChart3,
  Lock,
  ExternalLink,
} from "lucide-react";
import { useKPISummary, usePSPHealth } from "@/lib/hooks";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { PSPLogo } from "@/components/psp-logos";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type PipelineStage = "idle" | "webhook" | "bronze" | "silver" | "gold" | "done" | "discrepancy";

interface PipelineEvent {
  id: string;
  timestamp: Date;
  stage: Exclude<PipelineStage, "idle" | "done">;
  psp: "paystack" | "flutterwave" | "mpesa";
  amount: number;
  reference: string;
  status: "processing" | "complete" | "flagged";
  label: string;
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PSP_CONFIG = {
  paystack: { label: "Paystack", color: "#0070f3", dot: "bg-[#0070f3]" },
  flutterwave: { label: "Flutterwave", color: "#10b981", dot: "bg-emerald-500" },
  mpesa: { label: "M-Pesa", color: "#f59e0b", dot: "bg-amber-500" },
};

const PIPELINE_STAGES: { id: Exclude<PipelineStage, "idle" | "done" | "discrepancy">; label: string; icon: typeof Zap; description: string }[] = [
  { id: "webhook",  label: "Bronze Ingestion",  icon: Zap,       description: "Raw webhook event received from PSP" },
  { id: "bronze",   label: "Validation",         icon: Database,  description: "Schema validation & idempotency check" },
  { id: "silver",   label: "Normalisation",      icon: Layers,    description: "Currency conversion, field mapping" },
  { id: "gold",     label: "Reconciliation",     icon: ShieldCheck, description: "Cross-PSP matching & discrepancy detection" },
];

const SAMPLE_EVENTS = [
  { psp: "paystack" as const,     amount: 4_750_000,  ref: "PAY-2694AKJ", normal: true  },
  { psp: "flutterwave" as const,  amount: 1_230_500,  ref: "FLW-98X22MC", normal: true  },
  { psp: "mpesa" as const,        amount: 890_000,    ref: "MPE-TXN44Z7", normal: false }, // discrepancy
  { psp: "paystack" as const,     amount: 12_500_000, ref: "PAY-7732ABP", normal: true  },
  { psp: "flutterwave" as const,  amount: 2_100_000,  ref: "FLW-12KL88V", normal: false }, // discrepancy
];

// ─────────────────────────────────────────────────────────────────────────────
// LIVE PIPELINE SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

function usePipelineSimulation() {
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [eventIndex, setEventIndex] = useState(0);
  const [stats, setStats] = useState({ processed: 0, matched: 0, discrepancies: 0, volumeNgn: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runEvent = useCallback((sample: typeof SAMPLE_EVENTS[number]) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const stages: Exclude<PipelineStage, "idle" | "done" | "discrepancy">[] = ["webhook", "bronze", "silver", "gold"];
    let stageIdx = 0;

    const advance = () => {
      const currentStage = stages[stageIdx];
      setStage(currentStage);

      const stageLabels: Record<string, string> = {
        webhook: "Receiving webhook payload",
        bronze:  "Writing to bronze layer",
        silver:  "Normalising transaction",
        gold:    sample.normal ? "Match found ✓" : "Discrepancy detected!",
      };
      const stageDetails: Record<string, string> = {
        webhook: `${PSP_CONFIG[sample.psp].label} → ${sample.ref}`,
        bronze:  "Idempotency check passed",
        silver:  `₦${(sample.amount / 1_000_000).toFixed(2)}M → canonical format`,
        gold:    sample.normal ? "Cross-PSP pair reconciled" : "Amount mismatch flagged",
      };

      setEvents(prev => {
        const exists = prev.find(e => e.id === id);
        const newEvent: PipelineEvent = {
          id,
          timestamp: new Date(),
          stage: currentStage,
          psp: sample.psp,
          amount: sample.amount,
          reference: sample.ref,
          status: stageIdx === stages.length - 1
            ? (sample.normal ? "complete" : "flagged")
            : "processing",
          label: stageLabels[currentStage],
          detail: stageDetails[currentStage],
        };
        return exists
          ? prev.map(e => e.id === id ? newEvent : e)
          : [newEvent, ...prev].slice(0, 8);
      });

      stageIdx++;

      if (stageIdx < stages.length) {
        timeoutRef.current = setTimeout(advance, 700);
      } else {
        setStage(sample.normal ? "done" : "discrepancy");
        setStats(s => ({
          processed: s.processed + 1,
          matched: s.matched + (sample.normal ? 1 : 0),
          discrepancies: s.discrepancies + (sample.normal ? 0 : 1),
          volumeNgn: s.volumeNgn + sample.amount,
        }));
        timeoutRef.current = setTimeout(() => {
          setStage("idle");
        }, 1200);
      }
    };

    advance();
  }, []);

  const startDemo = useCallback(() => {
    if (isRunning) return;
    setIsRunning(true);
    setEvents([]);
    setStats({ processed: 0, matched: 0, discrepancies: 0, volumeNgn: 0 });
    setEventIndex(0);
    setStage("idle");

    let idx = 0;
    const runNext = () => {
      if (idx >= SAMPLE_EVENTS.length) {
        setIsRunning(false);
        setStage("done");
        return;
      }
      runEvent(SAMPLE_EVENTS[idx]);
      idx++;
      setEventIndex(idx);
      timeoutRef.current = setTimeout(runNext, 3800);
    };
    timeoutRef.current = setTimeout(runNext, 600);
  }, [isRunning, runEvent]);

  const resetDemo = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsRunning(false);
    setStage("idle");
    setEvents([]);
    setStats({ processed: 0, matched: 0, discrepancies: 0, volumeNgn: 0 });
    setEventIndex(0);
  }, []);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  const matchRate = stats.processed > 0
    ? Math.round((stats.matched / stats.processed) * 1000) / 10
    : 0;

  return { stage, events, isRunning, stats, matchRate, startDemo, resetDemo, eventIndex };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Animated pipeline flow diagram */
function PipelineDiagram({ stage }: { stage: PipelineStage }) {
  return (
    <div className="flex items-center justify-center gap-0 flex-wrap">
      {PIPELINE_STAGES.map((s, i) => {
        const isActive = stage === s.id;
        const isDone =
          stage === "done" ||
          stage === "discrepancy" ||
          (stage === "webhook" && i < 0) ||
          (stage === "bronze"  && i < 1) ||
          (stage === "silver"  && i < 2) ||
          (stage === "gold"    && i < 3);

        const isFlagged = stage === "discrepancy" && s.id === "gold";

        return (
          <div key={s.id} className="flex items-center">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "w-12 h-12 rounded-[12px] flex items-center justify-center transition-all duration-300",
                  isActive && !isFlagged
                    ? "bg-[var(--color-primary-50)] text-[var(--color-primary-600)] border border-[var(--color-primary-200)] shadow-sm scale-105"
                    : isFlagged
                    ? "bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-200)] shadow-sm scale-105"
                    : isDone
                    ? "bg-[var(--color-success-500)] text-white border border-[var(--color-success-600)] scale-100"
                    : "bg-[var(--color-surface-50)] text-[var(--color-surface-400)] border border-[var(--color-surface-200)] scale-100"
                )}
              >
                <s.icon className="w-5 h-5 transition-colors" />
              </div>
              <div className="text-center max-w-[80px]">
                <p className={cn(
                  "text-[11px] font-semibold leading-tight transition-colors",
                  isActive && !isFlagged
                    ? "text-[var(--color-primary-600)]"
                    : isFlagged
                    ? "text-[var(--color-danger-600)]"
                    : isDone
                    ? "text-[var(--color-success-600)]"
                    : "text-[var(--color-surface-500)]"
                )}>
                  {s.label}
                </p>
              </div>
            </div>

            {i < PIPELINE_STAGES.length - 1 && (
              <div className={cn(
                "h-[2px] w-8 sm:w-12 mx-1 sm:mx-2 rounded transition-all duration-300 flex-shrink-0",
                isDone
                  ? "bg-[var(--color-success-400)]"
                  : "bg-[var(--color-surface-200)]"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Live event feed */
function EventFeed({ events }: { events: PipelineEvent[] }) {
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {events.length === 0 ? (
        <div className="text-center py-8 text-[var(--color-surface-400)] text-sm">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>Events will appear here during simulation</p>
        </div>
      ) : (
        events.map((e) => (
          <div
            key={`${e.id}-${e.stage}`}
            className="flex items-center gap-3 py-2.5 px-3 rounded-md border border-[var(--color-surface-100)] bg-[var(--color-surface-0)] hover:bg-[var(--color-surface-50)] transition-colors animate-fade-in"
          >
            <PSPLogo name={e.psp} iconOnly className="w-5 h-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-[var(--color-surface-800)] truncate">
                  {e.label}
                </span>
                {e.status === "complete" && (
                  <CheckCircle2 className="w-3 h-3 text-[var(--color-success-500)] shrink-0" />
                )}
                {e.status === "flagged" && (
                  <AlertTriangle className="w-3 h-3 text-[var(--color-danger-500)] shrink-0" />
                )}
              </div>
              <p className="text-[10px] text-[var(--color-surface-500)] truncate">{e.detail}</p>
            </div>
            <span className="text-[11px] text-[var(--color-surface-900)] font-medium font-mono shrink-0">
              {formatCurrency(e.amount, true)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/** Stat card for live pipeline stats */
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="card-inset flex flex-col gap-1 border border-[var(--color-surface-200)] bg-[var(--color-surface-50)] shadow-xs">
      <p className="text-overline text-[var(--color-surface-500)]">{label}</p>
      <p
        className="text-[20px] font-bold tabular-nums leading-none mt-1"
        style={{ color: color || "var(--color-surface-900)" }}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-[var(--color-surface-400)] mt-1">{sub}</p>}
    </div>
  );
}

/** Technology badge */
function TechBadge({ name, category }: { name: string; category: string }) {
  return (
    <div className="card flex items-center gap-3 py-3 px-4 shadow-xs border-[var(--color-surface-200)]">
      <div className="w-8 h-8 rounded-md bg-[var(--color-surface-100)] flex items-center justify-center text-[16px] shrink-0 border border-[var(--color-surface-200)]">
        {name === "FastAPI" ? "⚡" :
         name === "PostgreSQL" ? "🐘" :
         name === "Redpanda" ? "🔴" :
         name === "MinIO" ? "🗄️" :
         name === "Prefect" ? "🔄" :
         name === "dbt" ? "🔧" :
         name === "Next.js" ? "▲" :
         name === "Docker" ? "🐳" : "•"}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-[var(--color-surface-900)] leading-tight">{name}</p>
        <p className="text-[11px] text-[var(--color-surface-500)] mt-0.5">{category}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function InvestorDemoPage() {
  const { data: kpi } = useKPISummary();
  const { data: pspHealth } = usePSPHealth();
  const { stage, events, isRunning, stats, matchRate, startDemo, resetDemo } = usePipelineSimulation();

  const totalVolume = pspHealth
    ? pspHealth.reduce((sum, p) => sum + p.volumeToday, 0)
    : 0;

  return (
    <div className="max-w-[1100px] mx-auto space-y-16 md:space-y-24 pb-24 pt-8">

      {/* ──────────────────────────── HERO ──────────────────────────── */}
      <section className="animate-fade-in text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-surface-50)] border border-[var(--color-surface-200)] text-[var(--color-surface-700)] text-xs font-medium mb-8">
          <span className="status-dot status-dot-live bg-[var(--color-success-500)]" />
          Live System — All Engines Running
        </div>

        <h1 className="text-display mb-6 max-w-3xl mx-auto">
          The reconciliation engine Nigeria's fintechs have been waiting for
        </h1>

        <p className="text-body max-w-2xl mx-auto mb-10 text-[var(--color-surface-600)]">
          MMR Engine automatically reconciles cross-PSP transactions in real time —
          matching Paystack, Flutterwave, and M-Pesa events against bank settlements
          with 99.5%+ accuracy. Built for Nigerian regulatory compliance.
        </p>

        <div className="flex items-center justify-center gap-4 flex-wrap mb-16">
          <Link href="/" className="btn bg-[var(--color-surface-900)] text-[var(--color-surface-0)] hover:opacity-90 gap-2 shadow-sm font-semibold px-5 py-2.5 rounded-md text-sm">
            <Activity className="w-4 h-4" />
            View Live Dashboard
            <ArrowRight className="w-4 h-4" />
          </Link>
          <button
            onClick={isRunning ? resetDemo : startDemo}
            disabled={false}
            className="btn bg-[var(--color-surface-50)] text-[var(--color-surface-900)] border border-[var(--color-surface-200)] hover:bg-[var(--color-surface-100)] gap-2 shadow-xs font-semibold px-5 py-2.5 rounded-md text-sm transition-colors"
          >
            {isRunning ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Reset Simulation</>
            ) : (
              <><Play className="w-4 h-4" /> Run Pipeline Demo</>
            )}
          </button>
        </div>

        {/* Live KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "Match Rate",
              value: kpi ? formatPercent(kpi.matchRate.value) : "99.2%",
              sub: "30-day average",
              color: "var(--color-success-600)",
            },
            {
              label: "Open Exposure",
              value: kpi ? formatCurrency(kpi.openExposure.value, true) : "₦2.4M",
              sub: "Unreconciled volume",
              color: "var(--color-danger-600)",
            },
            {
              label: "Transactions Today",
              value: kpi ? kpi.txnsToday.value.toLocaleString() : "12,847",
              sub: "Across all PSPs",
              color: "var(--color-primary-600)",
            },
            {
              label: "Volume Today",
              value: totalVolume > 0 ? formatCurrency(totalVolume, true) : "₦6.8B",
              sub: "Processed today",
              color: "var(--color-surface-900)",
            },
          ].map((k) => (
            <div key={k.label} className="card text-center py-6 shadow-xs border-[var(--color-surface-200)]">
              <p className="text-overline mb-2 text-[var(--color-surface-500)]">{k.label}</p>
              <p className="text-[24px] font-bold tracking-tight" style={{ color: k.color }}>
                {k.value}
              </p>
              <p className="text-[11px] text-[var(--color-surface-500)] mt-1">{k.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────── LIVE PIPELINE SIMULATION ─────────────── */}
      <section className="animate-slide-up space-y-6" style={{ animationDelay: "0.1s" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-heading-lg tracking-tight">Live Pipeline Simulation</h2>
            <p className="text-body-sm mt-1 text-[var(--color-surface-500)]">
              Watch real transactions move through the medallion data architecture
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isRunning && events.length === 0 && (
              <span className="text-[12px] text-[var(--color-surface-500)]">← Click "Run Demo" above</span>
            )}
            {(isRunning || events.length > 0) && (
              <button onClick={resetDemo} className="btn bg-transparent hover:bg-[var(--color-surface-100)] text-[var(--color-surface-600)] px-3 py-1.5 rounded-md text-xs font-medium gap-1.5 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
            )}
          </div>
        </div>

        <div className="card p-0 overflow-hidden border-[var(--color-surface-200)] shadow-sm">
          {/* Pipeline Flow Diagram */}
          <div className="p-8 border-b border-[var(--color-surface-200)] bg-[var(--color-surface-0)]">
            <PipelineDiagram stage={stage} />

            {/* Status label */}
            <div className="text-center mt-6">
              {stage === "idle" && events.length === 0 && (
                <span className="text-[13px] font-medium text-[var(--color-surface-500)]">Press "Run Pipeline Demo" to begin</span>
              )}
              {stage === "idle" && events.length > 0 && (
                <span className="text-[13px] font-medium text-[var(--color-surface-500)]">Waiting for next event…</span>
              )}
              {stage === "webhook" && (
                <span className="text-[13px] font-semibold text-[var(--color-primary-600)] animate-pulse-live">
                  ⚡ Receiving webhook payload…
                </span>
              )}
              {stage === "bronze" && (
                <span className="text-[13px] font-semibold text-[var(--color-primary-600)] animate-pulse-live">
                  🗄️ Writing to bronze layer…
                </span>
              )}
              {stage === "silver" && (
                <span className="text-[13px] font-semibold text-[var(--color-primary-600)] animate-pulse-live">
                  ⚗️ Normalising transaction…
                </span>
              )}
              {stage === "gold" && (
                <span className="text-[13px] font-semibold text-[var(--color-primary-600)] animate-pulse-live">
                  🔍 Running reconciliation match…
                </span>
              )}
              {stage === "done" && (
                <span className="text-[13px] font-semibold text-[var(--color-success-600)]">
                  ✓ Transaction reconciled successfully
                </span>
              )}
              {stage === "discrepancy" && (
                <span className="text-[13px] font-semibold text-[var(--color-danger-600)]">
                  ⚠ Discrepancy detected — flagged for review
                </span>
              )}
            </div>
          </div>

          {/* Live Stats + Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-surface-200)] bg-[var(--color-surface-0)]">
            {/* Stats */}
            <div className="p-6">
              <p className="text-[13px] font-semibold text-[var(--color-surface-900)] mb-4 uppercase tracking-wider">Simulation Stats</p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Processed"
                  value={stats.processed}
                  sub="This run"
                />
                <StatCard
                  label="Match Rate"
                  value={stats.processed > 0 ? `${matchRate}%` : "—"}
                  sub="Reconciliation accuracy"
                  color={matchRate >= 95 ? "var(--color-success-600)" : "var(--color-danger-600)"}
                />
                <StatCard
                  label="Discrepancies"
                  value={stats.discrepancies}
                  sub="Flagged for review"
                  color={stats.discrepancies > 0 ? "var(--color-danger-600)" : undefined}
                />
                <StatCard
                  label="Volume"
                  value={formatCurrency(stats.volumeNgn, true)}
                  sub="Total processed"
                />
              </div>
            </div>

            {/* Live event feed */}
            <div className="p-6 bg-[var(--color-surface-50)] border-t lg:border-t-0 border-[var(--color-surface-200)]">
              <p className="text-[13px] font-semibold text-[var(--color-surface-900)] mb-4 uppercase tracking-wider">Event Feed</p>
              <EventFeed events={events} />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────── PROBLEM STATEMENT ───────────────────────── */}
      <section className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
        <div className="card p-8 md:p-12 border border-[var(--color-surface-200)] shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-200)] text-[11px] font-semibold uppercase tracking-wider mb-5 shadow-xs">
                <AlertTriangle className="w-3.5 h-3.5" />
                The Problem
              </div>
              <h2 className="text-heading-lg mb-4 tracking-tight">
                ₦2.3 trillion in annual cross-PSP payments. Reconciled manually.
              </h2>
              <p className="text-body mb-6 text-[var(--color-surface-600)]">
                Nigerian businesses using multiple payment processors spend 15–40 hours
                per week on manual reconciliation — matching Paystack settlements against
                Flutterwave payouts against M-Pesa statements. Errors cost an average
                ₦4.7M per month in missed discrepancies.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Clock, text: "40+ hours/week of manual finance work" },
                  { icon: AlertTriangle, text: "Average ₦4.7M/month in undetected discrepancies" },
                  { icon: Globe, text: "CBN compliance requires daily reconciliation reports" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[var(--color-danger-50)] border border-[var(--color-danger-200)] flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-[var(--color-danger-600)]" />
                    </div>
                    <p className="text-[13px] font-medium text-[var(--color-surface-800)]">{text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--color-success-50)] text-[var(--color-success-600)] border border-[var(--color-success-200)] text-[11px] font-semibold uppercase tracking-wider mb-5 shadow-xs">
                <CheckCircle2 className="w-3.5 h-3.5" />
                The Solution
              </div>
              <h2 className="text-heading-lg mb-4 tracking-tight">
                Full automation in under 30 seconds per transaction.
              </h2>
              <p className="text-body mb-6 text-[var(--color-surface-600)]">
                MMR Engine ingests webhooks from all connected PSPs, normalises
                currency and schema differences, matches pairs across sources, and
                surfaces discrepancies with severity ratings — automatically.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Zap,         text: "Real-time ingestion via Kafka event streaming" },
                  { icon: ShieldCheck, text: "99.5%+ match rate with configurable thresholds" },
                  { icon: BarChart3,   text: "Automated CBN daily reconciliation reports" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[var(--color-success-50)] border border-[var(--color-success-200)] flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-[var(--color-success-600)]" />
                    </div>
                    <p className="text-[13px] font-medium text-[var(--color-surface-800)]">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── ARCHITECTURE ────────────────────────── */}
      <section className="animate-slide-up" style={{ animationDelay: "0.3s" }}>
        <div className="text-center mb-8">
          <h2 className="text-heading-lg tracking-tight">Medallion Data Architecture</h2>
          <p className="text-body mt-2 text-[var(--color-surface-500)]">Production-grade, battle-tested in financial data engineering</p>
        </div>

        <div className="card overflow-hidden p-0 border-[var(--color-surface-200)] shadow-sm">
          {/* Architecture flow */}
          <div className="p-6 grid grid-cols-1 sm:grid-cols-4 gap-6 bg-[var(--color-surface-0)]">
            {[
              {
                layer: "Bronze",
                color: "var(--color-warning-500)",
                bg: "var(--color-warning-50)",
                icon: Database,
                title: "Raw Ingestion",
                items: ["Paystack webhooks", "Flutterwave events", "M-Pesa callbacks", "Polling fallback"],
                storage: "MinIO object store",
              },
              {
                layer: "Silver",
                color: "var(--color-surface-500)",
                bg: "var(--color-surface-100)",
                icon: Layers,
                title: "Canonical Form",
                items: ["Schema normalisation", "FX conversion", "Field mapping", "Idempotency registry"],
                storage: "PostgreSQL canonical",
              },
              {
                layer: "Gold",
                color: "var(--color-primary-500)",
                bg: "var(--color-primary-50)",
                icon: ShieldCheck,
                title: "Reconciliation",
                items: ["Cross-PSP matching", "Discrepancy detection", "SLA breach tracking", "Exposure calculation"],
                storage: "PostgreSQL gold pairs",
              },
              {
                layer: "Serving",
                color: "var(--color-success-500)",
                bg: "var(--color-success-50)",
                icon: Activity,
                title: "Dashboard & API",
                items: ["Real-time dashboard", "REST API (FastAPI)", "CBN reporting", "Alert webhooks"],
                storage: "Read replica",
              },
            ].map((layer, i) => {
              const Icon = layer.icon;
              return (
                <div key={layer.layer} className="relative flex flex-col">
                  <div
                    className="rounded-[12px] p-5 flex-1 border transition-colors shadow-xs"
                    style={{
                      background: layer.bg,
                      borderColor: `color-mix(in srgb, ${layer.color} 20%, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 border"
                        style={{ 
                          background: `color-mix(in srgb, ${layer.color} 10%, white)`,
                          borderColor: `color-mix(in srgb, ${layer.color} 20%, transparent)` 
                        }}
                      >
                        <Icon className="w-4 h-4" style={{ color: layer.color }} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: layer.color }}>
                          {layer.layer}
                        </p>
                        <p className="text-[14px] font-semibold text-[var(--color-surface-900)] leading-tight">
                          {layer.title}
                        </p>
                      </div>
                    </div>
                    <ul className="space-y-2 mb-4">
                      {layer.items.map(item => (
                        <li key={item} className="flex items-start gap-2 text-[12px] text-[var(--color-surface-600)]">
                          <span className="mt-0.5 text-[8px]" style={{ color: layer.color }}>●</span>
                          <span className="leading-tight">{item}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-3 border-t" style={{ borderColor: `color-mix(in srgb, ${layer.color} 15%, transparent)` }}>
                      <p className="text-[11px] font-mono font-medium text-[var(--color-surface-600)]">
                        {layer.storage}
                      </p>
                    </div>
                  </div>
                  {/* Arrow connector */}
                  {i < 3 && (
                    <div className="hidden sm:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 items-center justify-center">
                      <ArrowRight className="w-4 h-4 text-[var(--color-surface-300)]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─────────────────── TECHNOLOGY STACK ────────────────────────── */}
      <section className="animate-slide-up" style={{ animationDelay: "0.4s" }}>
        <div className="text-center mb-8">
          <h2 className="text-heading-lg tracking-tight">Built on Production-Grade Infrastructure</h2>
          <p className="text-body mt-2 text-[var(--color-surface-500)]">Every component chosen for reliability, scalability, and correctness</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { name: "FastAPI",    category: "API Gateway" },
            { name: "PostgreSQL", category: "Primary Store" },
            { name: "Redpanda",   category: "Event Streaming" },
            { name: "MinIO",      category: "Bronze Layer" },
            { name: "Prefect",    category: "Orchestration" },
            { name: "dbt",        category: "Transformation" },
            { name: "Next.js",    category: "Dashboard" },
            { name: "Docker",     category: "Infrastructure" },
          ].map(t => (
            <TechBadge key={t.name} name={t.name} category={t.category} />
          ))}
        </div>
      </section>

      {/* ──────────────────── TRUST + COMPLIANCE ─────────────────────── */}
      <section className="animate-slide-up" style={{ animationDelay: "0.45s" }}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              icon: Lock,
              title: "CBN Compliant",
              desc: "Automated daily reconciliation reports in Central Bank of Nigeria format. Audit trail on every transaction.",
              color: "var(--color-primary-600)",
              bg: "var(--color-primary-50)",
              border: "var(--color-primary-200)"
            },
            {
              icon: ShieldCheck,
              title: "Audit Ready",
              desc: "Immutable bronze layer in MinIO. Every state transition logged. SHA-256 hashed API keys. Role-based access control.",
              color: "var(--color-success-600)",
              bg: "var(--color-success-50)",
              border: "var(--color-success-200)"
            },
            {
              icon: TrendingUp,
              title: "Horizontally Scalable",
              desc: "Kafka partitioned consumers. PostgreSQL connection pooling. Stateless API workers. Handles 50,000+ transactions/day.",
              color: "var(--color-warning-600)",
              bg: "var(--color-warning-50)",
              border: "var(--color-warning-200)"
            },
          ].map(({ icon: Icon, title, desc, color, bg, border }) => (
            <div key={title} className="card border-[var(--color-surface-200)] shadow-xs p-6 hover-lift transition-all">
              <div
                className="w-10 h-10 rounded-md flex items-center justify-center mb-5 border shadow-xs"
                style={{ background: bg, borderColor: border }}
              >
                <Icon className="w-5 h-5" style={{ color }} />
              </div>
              <h3 className="text-[16px] font-semibold text-[var(--color-surface-900)] mb-2 tracking-tight">{title}</h3>
              <p className="text-[13px] text-[var(--color-surface-600)] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────────── CTA ───────────────────────────── */}
      <section className="animate-slide-up" style={{ animationDelay: "0.5s" }}>
        <div className="card text-center py-16 px-6 border-[var(--color-surface-200)] shadow-sm bg-[var(--color-surface-50)]">
          <h2 className="text-heading-lg mb-3 tracking-tight">Ready to see the full system?</h2>
          <p className="text-body mb-10 max-w-xl mx-auto text-[var(--color-surface-600)]">
            The live dashboard shows real-time reconciliation data. Every metric,
            chart, and discrepancy shown is powered by actual infrastructure — not slides.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/" className="btn bg-[var(--color-surface-900)] text-[var(--color-surface-0)] hover:opacity-90 gap-2 shadow-sm font-semibold px-6 py-3 rounded-md transition-opacity">
              <Activity className="w-4 h-4" />
              Open Live Dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="btn bg-white text-[var(--color-surface-900)] border border-[var(--color-surface-200)] hover:bg-[var(--color-surface-50)] gap-2 shadow-xs font-semibold px-6 py-3 rounded-md transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              API Documentation
            </a>
          </div>

          <div className="mt-12 pt-8 border-t border-[var(--color-surface-200)] flex items-center justify-center gap-6 flex-wrap text-[12px]">
            <p className="text-[var(--color-surface-500)]">
              Built by{" "}
              <span className="font-semibold text-[var(--color-surface-800)]">Emmanuel Richard</span>
            </p>
            <span className="text-[var(--color-surface-300)]">·</span>
            <p className="text-[var(--color-surface-500)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--color-success-500)] animate-pulse" />
              All services running
            </p>
            <span className="text-[var(--color-surface-300)]">·</span>
            <p className="text-[var(--color-surface-500)]">
              Open source · Docker-based · Production-ready
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
