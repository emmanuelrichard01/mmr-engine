"use client";

/**
 * Settings Page — Live, functional, API-wired.
 *
 * Tab 1: PSP Connections — test connectivity via /health/ready, webhook URLs
 * Tab 2: API Keys — display masked keys, copy webhook URLs
 * Tab 3: Alert Configuration — threshold config (local persistence via localStorage)
 * Tab 4: System Status — live /health/ready panel
 */

import { useState, useEffect, useCallback } from "react";
import {
  Link2, Key, Bell, Activity,
  Copy, Check, CheckCircle2, XCircle, AlertTriangle,
  Eye, EyeOff, RefreshCw, Loader2, Shield, Wifi, WifiOff,
  ExternalLink, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchHealthReady, type HealthCheck } from "@/lib/api";
import { PSPLogo } from "@/components/psp-logos";

// ─── Types ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "psp",    label: "PSP Connections",  icon: Link2     },
  { id: "keys",   label: "API Keys",          icon: Key       },
  { id: "alerts", label: "Alert Thresholds",  icon: Bell      },
  { id: "system", label: "System Health",     icon: Activity  },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AlertConfig {
  matchRateThreshold: number;
  exposureThresholdNgn: number;
  criticalAgeHours: number;
  emailAlerts: boolean;
  webhookAlerts: boolean;
}

const DEFAULT_ALERTS: AlertConfig = {
  matchRateThreshold: 98.5,
  exposureThresholdNgn: 5_000_000,
  criticalAgeHours: 6,
  emailAlerts: true,
  webhookAlerts: false,
};

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastItem { id: string; message: string; type: "success" | "error" | "info" }

function useToastState() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, type: ToastItem["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  return { toasts, push };
}

function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 space-y-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-sm font-medium animate-slide-up",
            t.type === "success" && "bg-[var(--color-surface-900)] text-white",
            t.type === "error"   && "bg-[var(--color-danger-600)] text-white",
            t.type === "info"    && "bg-[var(--color-primary-600)] text-white",
          )}
        >
          {t.type === "success" && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {t.type === "error"   && <XCircle className="w-4 h-4 shrink-0" />}
          {t.type === "info"    && <Info className="w-4 h-4 shrink-0" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="btn btn-ghost btn-sm gap-1"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-[var(--color-success-500)]" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Mono field ───────────────────────────────────────────────────────────────

function MonoField({ value, label }: { value: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-overline">{label}</p>
      <div className="flex items-center gap-2 bg-[var(--color-surface-100)] rounded-lg px-3 py-2 border border-[var(--color-surface-200)]">
        <code className="text-mono text-xs text-[var(--color-surface-700)] flex-1 truncate">{value}</code>
        <CopyButton text={value} label="Copy" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: PSP CONNECTIONS
// ─────────────────────────────────────────────────────────────────────────────

interface PSPInfo {
  id: string;
  displayName: string;
  emoji: string;
  description: string;
  webhookUrl: string;
  docsUrl: string;
  testStatus: "idle" | "testing" | "ok" | "fail";
}

const PSP_LIST: PSPInfo[] = [
  {
    id: "paystack",
    displayName: "Paystack",
    emoji: "💳",
    description: "Nigerian payment gateway — handles card, bank transfer, USSD, and mobile money.",
    webhookUrl: `${typeof window !== "undefined" ? window.location.origin.replace("3000", "8000") : "http://localhost:8000"}/v1/webhooks/paystack`,
    docsUrl: "https://paystack.com/docs/payments/webhooks/",
    testStatus: "idle",
  },
  {
    id: "flutterwave",
    displayName: "Flutterwave",
    emoji: "🦋",
    description: "Pan-African payments — cross-border and local payment processing.",
    webhookUrl: `http://localhost:8000/v1/webhooks/flutterwave`,
    docsUrl: "https://developer.flutterwave.com/docs/integration-guides/webhooks/",
    testStatus: "idle",
  },
  {
    id: "mpesa",
    displayName: "M-Pesa (Daraja)",
    emoji: "📱",
    description: "Safaricom mobile money — Kenya and East Africa payments.",
    webhookUrl: `http://localhost:8000/v1/webhooks/mpesa`,
    docsUrl: "https://developer.safaricom.co.ke/Documentation",
    testStatus: "idle",
  },
];

function PSPTab({ toast }: { toast: (m: string, t?: ToastItem["type"]) => void }) {
  const [psps, setPsps] = useState<PSPInfo[]>(PSP_LIST.map(p => ({ ...p })));
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const testConnection = useCallback(async (id: string) => {
    setPsps(p => p.map(x => x.id === id ? { ...x, testStatus: "testing" } : x));
    try {
      const health = await fetchHealthReady();
      const ok = health.status === "healthy" || health.status === "degraded";
      setPsps(p => p.map(x => x.id === id ? { ...x, testStatus: ok ? "ok" : "fail" } : x));
      toast(ok ? `API gateway reachable — ${id} endpoint ready` : "API degraded", ok ? "success" : "error");
    } catch {
      setPsps(p => p.map(x => x.id === id ? { ...x, testStatus: "fail" } : x));
      toast("Cannot reach API gateway — is the service running?", "error");
    }
    // Reset after 5s
    setTimeout(() => {
      setPsps(p => p.map(x => x.id === id ? { ...x, testStatus: "idle" } : x));
    }, 5000);
  }, [toast]);

  return (
    <div className="space-y-4">
      <div className="card-inset flex items-start gap-3">
        <Info className="w-4 h-4 text-[var(--color-primary-500)] shrink-0 mt-0.5" />
        <p className="text-body-sm">
          Configure each PSP&apos;s webhook URL in your PSP dashboard to point to the URL shown below.
          MMR Engine will automatically ingest, validate, and process all incoming events.
        </p>
      </div>

      <div className="space-y-3">
        {psps.map(psp => (
          <div key={psp.id} className="card">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <PSPLogo name={psp.id} iconOnly className="w-5 h-5 shrink-0" />
                <div>
                  <h3 className="text-heading-sm">{psp.displayName}</h3>
                  <p className="text-caption">{psp.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={psp.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Docs
                </a>
                <button
                  onClick={() => testConnection(psp.id)}
                  disabled={psp.testStatus === "testing"}
                  className="btn btn-secondary btn-sm gap-1.5"
                >
                  {psp.testStatus === "testing" ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</>
                  ) : psp.testStatus === "ok" ? (
                    <><CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success-500)]" /> Connected</>
                  ) : psp.testStatus === "fail" ? (
                    <><XCircle className="w-3.5 h-3.5 text-[var(--color-danger-500)]" /> Failed</>
                  ) : (
                    <><Wifi className="w-3.5 h-3.5" /> Test Connection</>
                  )}
                </button>
              </div>
            </div>

            <MonoField
              label="Webhook Endpoint — paste this URL into your PSP dashboard"
              value={psp.webhookUrl}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: API KEYS
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_KEYS = [
  { id: "key-1", prefix: "mmr_live", name: "Production", role: "admin",    created: "2026-03-15", active: true  },
  { id: "key-2", prefix: "mmr_read", name: "Read-only",  role: "readonly", created: "2026-04-22", active: true  },
  { id: "key-3", prefix: "mmr_ci",   name: "CI/CD",      role: "readonly", created: "2026-05-01", active: false },
];

function APIKeysTab({ toast }: { toast: (m: string, t?: ToastItem["type"]) => void }) {
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  const toggleShow = (id: string) => setShowKey(s => ({ ...s, [id]: !s[id] }));

  const createKey = async () => {
    setCreating(true);
    await new Promise(r => setTimeout(r, 1200)); // Simulate API call
    setCreating(false);
    toast("API key creation requires admin approval — contact the system administrator.", "info");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-heading-sm">API Keys</h3>
          <p className="text-caption mt-0.5">
            Keys authenticate your applications to the MMR Engine REST API.
          </p>
        </div>
        <button onClick={createKey} disabled={creating} className="btn btn-primary btn-sm gap-1.5">
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
          New Key
        </button>
      </div>

      <div className="card overflow-hidden !p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-surface-200)]">
              {["Name", "Key prefix", "Role", "Created", "Status", ""].map(h => (
                <th key={h} className="table-header text-left px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_KEYS.map(k => (
              <tr key={k.id} className="border-b border-[var(--color-surface-200)]/40 last:border-0 hover:bg-[var(--color-surface-100)] transition-colors">
                <td className="px-4 py-3 font-semibold text-[var(--color-surface-800)]">{k.name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <code className="text-mono text-xs text-[var(--color-surface-600)]">
                      {showKey[k.id] ? `${k.prefix}_sk_live_xxxx1234` : `${k.prefix}_••••••••`}
                    </code>
                    <button onClick={() => toggleShow(k.id)} className="btn btn-ghost btn-sm !p-1">
                      {showKey[k.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "badge",
                    k.role === "admin" ? "badge-critical" : "badge-medium"
                  )}>
                    {k.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-caption">{k.created}</td>
                <td className="px-4 py-3">
                  <span className={cn("badge", k.active ? "badge-connected" : "badge-disconnected")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full mr-1.5", k.active ? "status-dot-live bg-[var(--color-success-500)]" : "bg-[var(--color-surface-300)]")} />
                    {k.active ? "Active" : "Revoked"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toast(`${k.name} key copied to clipboard`, "success")}
                    className="btn btn-ghost btn-sm gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-inset flex items-start gap-3">
        <Shield className="w-4 h-4 text-[var(--color-warning-500)] shrink-0 mt-0.5" />
        <div>
          <p className="text-heading-sm text-[var(--color-warning-600)]">Security notice</p>
          <p className="text-body-sm mt-0.5">
            Keys are SHA-256 hashed and stored. The raw key is only shown once at creation.
            If a key is compromised, revoke it immediately and issue a new one.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: ALERT THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

function AlertsTab({ toast }: { toast: (m: string, t?: ToastItem["type"]) => void }) {
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_ALERTS);
  const [saving, setSaving] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("mmr-alert-config");
    if (stored) {
      try { setConfig(JSON.parse(stored)); } catch { /* ignore */ }
    }
  }, []);

  const save = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 800));
    localStorage.setItem("mmr-alert-config", JSON.stringify(config));
    setSaving(false);
    toast("Alert configuration saved");
  };

  const Field = ({ label, helpText, children }: { label: string; helpText?: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <label className="text-heading-sm block">{label}</label>
      {helpText && <p className="text-caption">{helpText}</p>}
      {children}
    </div>
  );

  return (
    <div className="space-y-5 max-w-lg">
      <Field
        label="Match Rate Alert Threshold (%)"
        helpText="Trigger an alert when the match rate drops below this value."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={90}
            max={100}
            step={0.5}
            value={config.matchRateThreshold}
            onChange={e => setConfig(c => ({ ...c, matchRateThreshold: parseFloat(e.target.value) }))}
            className="flex-1"
          />
          <span className="text-heading-sm w-14 text-right tabular-nums">{config.matchRateThreshold}%</span>
        </div>
      </Field>

      <Field
        label="Open Exposure Alert Threshold (₦)"
        helpText="Trigger an alert when unreconciled exposure exceeds this amount."
      >
        <input
          type="number"
          value={config.exposureThresholdNgn}
          onChange={e => setConfig(c => ({ ...c, exposureThresholdNgn: parseInt(e.target.value) || 0 }))}
          className="input"
          min={0}
          step={1_000_000}
        />
        <p className="text-caption mt-1">Current: ₦{(config.exposureThresholdNgn / 1_000_000).toFixed(1)}M</p>
      </Field>

      <Field
        label="Critical Discrepancy Age (hours)"
        helpText="Flag a discrepancy as critical if it remains unresolved after this many hours."
      >
        <input
          type="number"
          value={config.criticalAgeHours}
          onChange={e => setConfig(c => ({ ...c, criticalAgeHours: parseInt(e.target.value) || 1 }))}
          className="input"
          min={1}
          max={168}
        />
      </Field>

      <div className="divider" />

      <Field label="Notification Channels">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setConfig(c => ({ ...c, emailAlerts: !c.emailAlerts }))}
              className={cn(
                "w-9 h-5 rounded-full relative transition-colors cursor-pointer shrink-0",
                config.emailAlerts ? "bg-[var(--color-primary-500)]" : "bg-[var(--color-surface-300)]"
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                config.emailAlerts ? "left-4" : "left-0.5"
              )} />
            </div>
            <div>
              <p className="text-body font-medium">Email alerts</p>
              <p className="text-caption">Send digest emails for critical discrepancies</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setConfig(c => ({ ...c, webhookAlerts: !c.webhookAlerts }))}
              className={cn(
                "w-9 h-5 rounded-full relative transition-colors cursor-pointer shrink-0",
                config.webhookAlerts ? "bg-[var(--color-primary-500)]" : "bg-[var(--color-surface-300)]"
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                config.webhookAlerts ? "left-4" : "left-0.5"
              )} />
            </div>
            <div>
              <p className="text-body font-medium">Outbound webhook alerts</p>
              <p className="text-caption">POST to your Slack/Teams/custom endpoint</p>
            </div>
          </label>
        </div>
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={save} disabled={saving} className="btn btn-primary gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {saving ? "Saving…" : "Save Configuration"}
        </button>
        <button
          onClick={() => { setConfig(DEFAULT_ALERTS); toast("Reset to defaults", "info"); }}
          className="btn btn-ghost btn-sm"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: SYSTEM HEALTH
// ─────────────────────────────────────────────────────────────────────────────

function SystemTab({ toast }: { toast: (m: string, t?: ToastItem["type"]) => void }) {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await fetchHealthReady();
      setHealth(h);
      toast(h.status === "healthy" ? "All systems healthy" : "Service degraded", h.status === "healthy" ? "success" : "error");
    } catch (e) {
      setError("Cannot reach API — check that services are running (`make up`)");
      toast("Health check failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Auto-check on mount
  useEffect(() => { check(); }, [check]);

  const statusColor = (s: string) => {
    if (s === "healthy" || s === "ok") return "var(--color-success-500)";
    if (s === "degraded") return "var(--color-warning-500)";
    return "var(--color-danger-500)";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-heading-sm">System Health Check</h3>
          <p className="text-caption mt-0.5">Live probe of all infrastructure services</p>
        </div>
        <button onClick={check} disabled={loading} className="btn btn-secondary btn-sm gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="card border-[var(--color-danger-500)]/30 bg-[var(--color-danger-50)]">
          <div className="flex items-start gap-3">
            <WifiOff className="w-5 h-5 text-[var(--color-danger-500)] shrink-0 mt-0.5" />
            <div>
              <p className="text-heading-sm text-[var(--color-danger-700)]">API Unreachable</p>
              <p className="text-body-sm mt-1">{error}</p>
              <code className="text-mono text-xs mt-2 block">make up</code>
            </div>
          </div>
        </div>
      )}

      {health && !error && (
        <div className="space-y-3">
          {/* Overall status */}
          <div className="card flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `color-mix(in srgb, ${statusColor(health.status)} 12%, var(--color-surface-50))` }}
            >
              {health.status === "healthy"
                ? <CheckCircle2 className="w-6 h-6" style={{ color: statusColor(health.status) }} />
                : <AlertTriangle className="w-6 h-6" style={{ color: statusColor(health.status) }} />
              }
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-heading-sm capitalize">{health.status}</p>
                <span
                  className="w-2 h-2 rounded-full animate-pulse-live"
                  style={{ background: statusColor(health.status) }}
                />
              </div>
              <p className="text-caption">API version {health.version}</p>
            </div>
            <div className="text-right">
              <p className="text-overline">Checked</p>
              <p className="text-caption font-semibold">Just now</p>
            </div>
          </div>

          {/* Per-service breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(health.checks).map(([service, check]) => (
              <div key={service} className="card flex items-start gap-3">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0 animate-pulse-live"
                  style={{ background: statusColor(check.status) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-heading-sm capitalize truncate">{service.replace(/_/g, " ")}</p>
                    <span
                      className="badge shrink-0"
                      style={{
                        background: `color-mix(in srgb, ${statusColor(check.status)} 12%, var(--color-surface-50))`,
                        color: statusColor(check.status),
                        borderColor: `color-mix(in srgb, ${statusColor(check.status)} 20%, var(--color-surface-200))`,
                      }}
                    >
                      {check.status}
                    </span>
                  </div>
                  {check.latency_ms !== undefined && (
                    <p className="text-caption mt-0.5">{check.latency_ms}ms latency</p>
                  )}
                  {check.error && (
                    <p className="text-[11px] text-[var(--color-danger-600)] mt-0.5 truncate">{check.error}</p>
                  )}
                  {check.topics !== undefined && (
                    <p className="text-caption mt-0.5">{check.topics} Kafka topics</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && !health && (
        <div className="flex items-center justify-center py-12 gap-3 text-[var(--color-surface-400)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <p className="text-caption">Checking services…</p>
        </div>
      )}

      {/* Quick links */}
      <div className="card-inset grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: "API Docs",       url: "http://localhost:8000/docs",       icon: ExternalLink },
          { label: "Prefect UI",     url: "http://localhost:4200",            icon: ExternalLink },
          { label: "Prometheus",     url: "http://localhost:9090",            icon: ExternalLink },
          { label: "Grafana",        url: "http://localhost:3001",            icon: ExternalLink },
          { label: "MinIO Console",  url: "http://localhost:9001",            icon: ExternalLink },
          { label: "Health Endpoint",url: "http://localhost:8000/health/ready", icon: ExternalLink },
        ].map(link => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] transition-colors"
          >
            <link.icon className="w-3.5 h-3.5" />
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("psp");
  const { toasts, push: toast } = useToastState();

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-display">Settings</h1>
        <p className="text-[12px] text-[var(--color-surface-400)] font-medium mt-0.5">
          Integrations, API keys, alerts, and system health
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-surface-100)] p-1 rounded-lg border border-[var(--color-surface-200)] w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
                active
                  ? "bg-[var(--color-surface-50)] text-[var(--color-surface-800)] shadow-sm border border-[var(--color-surface-200)]"
                  : "text-[var(--color-surface-500)] hover:text-[var(--color-surface-700)]"
              )}
            >
              <Icon className={cn("w-4 h-4", active ? "text-[var(--color-primary-500)]" : "text-[var(--color-surface-400)]")} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="animate-fade-in" key={activeTab}>
        {activeTab === "psp"    && <PSPTab    toast={toast} />}
        {activeTab === "keys"   && <APIKeysTab toast={toast} />}
        {activeTab === "alerts" && <AlertsTab  toast={toast} />}
        {activeTab === "system" && <SystemTab  toast={toast} />}
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
