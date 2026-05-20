"use client";

import { useState } from "react";
import {
  Settings,
  Link2,
  Key,
  Bell,
  Users,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  X,
  Plus,
  Trash2,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tab Definitions ──────────────────────────────────────────────────

const tabs = [
  { id: "psp", label: "PSP Connections", icon: Link2 },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "alerts", label: "Alert Configuration", icon: Bell },
  { id: "team", label: "Team", icon: Users },
] as const;

type TabId = (typeof tabs)[number]["id"];

// ── Mock Data ────────────────────────────────────────────────────────

interface PSPConnection {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  connected: boolean;
  maskedKey?: string;
  lastVerified?: string;
  webhookUrl: string;
}

const mockPSPs: PSPConnection[] = [
  {
    id: "paystack",
    name: "paystack",
    displayName: "Paystack",
    icon: "🟢",
    connected: true,
    maskedKey: "••••••••sk_live_abc123",
    lastVerified: "2026-05-19T14:30:00Z",
    webhookUrl: "https://api.mmr.finance/webhooks/paystack/wh_8f3k2m",
  },
  {
    id: "flutterwave",
    name: "flutterwave",
    displayName: "Flutterwave",
    icon: "🟡",
    connected: true,
    maskedKey: "••••••••FLWSECK-xyz789",
    lastVerified: "2026-05-18T09:15:00Z",
    webhookUrl: "https://api.mmr.finance/webhooks/flutterwave/wh_9a4l3n",
  },
  {
    id: "mpesa",
    name: "mpesa",
    displayName: "M-Pesa",
    icon: "🔵",
    connected: false,
    webhookUrl: "https://api.mmr.finance/webhooks/mpesa/wh_7b5m4p",
  },
];

interface APIKey {
  id: string;
  prefix: string;
  role: "admin" | "readonly";
  createdAt: string;
  status: "active" | "revoked";
}

const mockAPIKeys: APIKey[] = [
  {
    id: "key-1",
    prefix: "mmr_live",
    role: "admin",
    createdAt: "2026-03-15T10:00:00Z",
    status: "active",
  },
  {
    id: "key-2",
    prefix: "mmr_read",
    role: "readonly",
    createdAt: "2026-04-22T16:30:00Z",
    status: "active",
  },
];

// ── Main Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("psp");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15">
            <Settings className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">
              Settings
            </h1>
            <p className="text-sm text-surface-500 mt-0.5">
              Manage integrations, API keys, alerts, and team access
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: "0.1s" }}
      >
        <div className="flex gap-1 border-b border-surface-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "text-primary-400"
                    : "text-surface-500 hover:text-surface-700"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                {/* Active underline indicator */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500 rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: "0.2s" }}
      >
        {activeTab === "psp" && <PSPConnectionsTab />}
        {activeTab === "api-keys" && <APIKeysTab />}
        {activeTab === "alerts" && <AlertConfigTab />}
        {activeTab === "team" && <TeamTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tab 1: PSP Connections
// ═══════════════════════════════════════════════════════════════════════

function PSPConnectionsTab() {
  const [psps, setPsps] = useState(mockPSPs);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);

  const handleCopy = async (text: string, pspId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(pspId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: ignored for demo
    }
  };

  const handleDisconnect = (pspId: string) => {
    setPsps((prev) =>
      prev.map((p) =>
        p.id === pspId
          ? { ...p, connected: false, maskedKey: undefined, lastVerified: undefined }
          : p
      )
    );
    setDisconnectTarget(null);
  };

  const handleConnect = (pspId: string) => {
    setPsps((prev) =>
      prev.map((p) =>
        p.id === pspId
          ? {
              ...p,
              connected: true,
              maskedKey: "••••••••demo_key_" + pspId,
              lastVerified: new Date().toISOString(),
            }
          : p
      )
    );
  };

  return (
    <div className="space-y-4">
      {psps.map((psp, i) => (
        <div
          key={psp.id}
          className="card animate-fade-in"
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            {/* PSP Info */}
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-100 text-2xl shrink-0">
                {psp.icon}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-semibold text-surface-900">
                    {psp.displayName}
                  </h3>
                  <span
                    className={cn(
                      "badge",
                      psp.connected ? "badge-connected" : "badge-disconnected"
                    )}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full inline-block",
                        psp.connected ? "bg-success-400" : "bg-surface-500"
                      )}
                    />
                    {psp.connected ? "Connected" : "Disconnected"}
                  </span>
                </div>

                {psp.connected && psp.maskedKey && (
                  <div className="space-y-1">
                    <p className="text-xs text-surface-500">
                      API Key:{" "}
                      <code className="font-mono text-surface-600 bg-surface-100 px-1.5 py-0.5 rounded">
                        {psp.maskedKey}
                      </code>
                    </p>
                    {psp.lastVerified && (
                      <p className="text-xs text-surface-500">
                        Last verified:{" "}
                        <span className="text-surface-600">
                          {new Date(psp.lastVerified).toLocaleDateString(
                            "en-NG",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {psp.connected ? (
                <button
                  onClick={() => setDisconnectTarget(psp.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-danger-400 bg-danger-500/10 hover:bg-danger-500/20 border border-danger-500/20 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleConnect(psp.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-400 bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Connect
                </button>
              )}
            </div>
          </div>

          {/* Webhook URL */}
          <div className="mt-4 pt-4 border-t border-surface-200">
            <p className="text-xs text-surface-500 mb-2">Webhook URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-surface-600 bg-surface-100 px-3 py-2 rounded-lg truncate border border-surface-200">
                {psp.webhookUrl}
              </code>
              <button
                onClick={() => handleCopy(psp.webhookUrl, psp.id)}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-100 hover:bg-surface-200 border border-surface-200 text-surface-500 hover:text-surface-700 transition-colors shrink-0"
                aria-label="Copy webhook URL"
              >
                {copiedId === psp.id ? (
                  <Check className="w-3.5 h-3.5 text-success-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Disconnect Confirmation */}
          {disconnectTarget === psp.id && (
            <div className="mt-4 p-4 rounded-lg bg-danger-500/5 border border-danger-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-danger-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-surface-800">
                    Disconnect {psp.displayName}?
                  </p>
                  <p className="text-xs text-surface-500 mt-1">
                    This will revoke API access and stop receiving webhooks.
                    Existing transaction data will be preserved.
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleDisconnect(psp.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-danger-500 hover:bg-danger-600 transition-colors"
                    >
                      Yes, Disconnect
                    </button>
                    <button
                      onClick={() => setDisconnectTarget(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-surface-600 hover:text-surface-800 bg-surface-100 hover:bg-surface-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tab 2: API Keys
// ═══════════════════════════════════════════════════════════════════════

function APIKeysTab() {
  const [keys, setKeys] = useState(mockAPIKeys);
  const [showModal, setShowModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);

  const handleGenerateKey = () => {
    const newKey =
      "mmr_live_" +
      Array.from({ length: 32 }, () =>
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
          Math.floor(Math.random() * 62)
        )
      ).join("");
    setGeneratedKey(newKey);
    setShowModal(true);
    setKeyCopied(false);

    // Add to list
    setKeys((prev) => [
      ...prev,
      {
        id: `key-${Date.now()}`,
        prefix: newKey.slice(0, 8),
        role: "readonly" as const,
        createdAt: new Date().toISOString(),
        status: "active" as const,
      },
    ]);
  };

  const handleRevoke = (keyId: string) => {
    setKeys((prev) =>
      prev.map((k) =>
        k.id === keyId ? { ...k, status: "revoked" as const } : k
      )
    );
  };

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(generatedKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      // Fallback ignored for demo
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-surface-900">
            API Keys
          </h3>
          <p className="text-xs text-surface-500 mt-0.5">
            Manage programmatic access to the MMR API
          </p>
        </div>
        <button
          onClick={handleGenerateKey}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Generate New Key
        </button>
      </div>

      {/* Keys Table */}
      <div className="card">
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200">
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Key Prefix
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Role
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Created At
                </th>
                <th className="text-left text-xs font-medium text-surface-500 pb-3 pr-4">
                  Status
                </th>
                <th className="text-right text-xs font-medium text-surface-500 pb-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((apiKey, i) => (
                <tr
                  key={apiKey.id}
                  className="border-b border-surface-200/50 last:border-0 animate-fade-in"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <td className="py-3 pr-4">
                    <code className="font-mono text-xs text-surface-700 bg-surface-100 px-2 py-0.5 rounded">
                      {apiKey.prefix}••••
                    </code>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={cn(
                        "badge",
                        apiKey.role === "admin"
                          ? "bg-primary-500/15 text-primary-400 border border-primary-500/25"
                          : "bg-surface-300/20 text-surface-600 border border-surface-300/30"
                      )}
                    >
                      {apiKey.role === "admin" ? (
                        <Shield className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                      {apiKey.role === "admin" ? "Admin" : "Read-only"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-surface-600">
                    {new Date(apiKey.createdAt).toLocaleDateString("en-NG", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={cn(
                        "badge",
                        apiKey.status === "active"
                          ? "badge-connected"
                          : "bg-danger-500/15 text-danger-400"
                      )}
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full inline-block",
                          apiKey.status === "active"
                            ? "bg-success-400"
                            : "bg-danger-400"
                        )}
                      />
                      {apiKey.status === "active" ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {apiKey.status === "active" && (
                      <button
                        onClick={() => handleRevoke(apiKey.id)}
                        className="flex items-center gap-1 ml-auto text-xs font-medium text-danger-400 hover:text-danger-300 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generated Key Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative w-full max-w-md card bg-surface-50 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-500/15">
                  <CheckCircle2 className="w-4 h-4 text-success-400" />
                </div>
                <h3 className="text-base font-semibold text-surface-900">
                  API Key Generated
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-surface-200 text-surface-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-surface-100 border border-surface-200">
              <p className="text-xs text-surface-500 mb-2">
                Your new API key (copy it now — it won&apos;t be shown again):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-surface-800 break-all">
                  {generatedKey}
                </code>
                <button
                  onClick={handleCopyKey}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-200 hover:bg-surface-300 text-surface-600 transition-colors shrink-0"
                >
                  {keyCopied ? (
                    <Check className="w-3.5 h-3.5 text-success-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-warning-500/5 border border-warning-500/15">
              <AlertTriangle className="w-4 h-4 text-warning-400 shrink-0 mt-0.5" />
              <p className="text-xs text-surface-500">
                Store this key securely. For security reasons, we cannot display
                it again after you close this dialog.
              </p>
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="w-full mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tab 3: Alert Configuration
// ═══════════════════════════════════════════════════════════════════════

function AlertConfigTab() {
  const [slackUrl, setSlackUrl] = useState(
    "https://hooks.slack.com/services/T01••••••/B02••••••/xxxx"
  );
  const [showSlackUrl, setShowSlackUrl] = useState(false);
  const [exposureThreshold, setExposureThreshold] = useState("5000000");
  const [confidenceThreshold, setConfidenceThreshold] = useState("85");
  const [fxVariance, setFxVariance] = useState("2.5");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Slack Webhook */}
      <div className="card">
        <h3 className="text-base font-semibold text-surface-900 mb-1">
          Slack Notifications
        </h3>
        <p className="text-xs text-surface-500 mb-4">
          Receive alerts in your Slack channel when thresholds are exceeded
        </p>

        <label className="block text-xs font-medium text-surface-600 mb-2">
          Webhook URL
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showSlackUrl ? "text" : "password"}
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-surface-100 border border-surface-200 text-surface-800 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/50 transition-all font-mono"
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
          <button
            onClick={() => setShowSlackUrl(!showSlackUrl)}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-100 hover:bg-surface-200 border border-surface-200 text-surface-500 hover:text-surface-700 transition-colors shrink-0"
            aria-label={showSlackUrl ? "Hide URL" : "Show URL"}
          >
            {showSlackUrl ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Alert Thresholds */}
      <div className="card">
        <h3 className="text-base font-semibold text-surface-900 mb-1">
          Alert Thresholds
        </h3>
        <p className="text-xs text-surface-500 mb-6">
          Set limits that trigger automatic alerts when exceeded
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Exposure Threshold */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-2">
              Exposure Threshold (NGN)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
                ₦
              </span>
              <input
                type="text"
                value={Number(exposureThreshold).toLocaleString("en-NG")}
                onChange={(e) =>
                  setExposureThreshold(e.target.value.replace(/[^0-9]/g, ""))
                }
                className="w-full pl-7 pr-3 py-2 rounded-lg text-sm bg-surface-100 border border-surface-200 text-surface-800 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/50 transition-all tabular-nums"
              />
            </div>
            <p className="text-[10px] text-surface-500 mt-1.5">
              Alert when open exposure exceeds this amount
            </p>
          </div>

          {/* Confidence Threshold */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-2">
              Confidence Threshold (%)
            </label>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={100}
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-surface-100 border border-surface-200 text-surface-800 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/50 transition-all tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
                %
              </span>
            </div>
            <p className="text-[10px] text-surface-500 mt-1.5">
              Alert when match confidence falls below this level
            </p>
          </div>

          {/* FX Variance Threshold */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-2">
              FX Variance Threshold (%)
            </label>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={fxVariance}
                onChange={(e) => setFxVariance(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-surface-100 border border-surface-200 text-surface-800 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/50 transition-all tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
                %
              </span>
            </div>
            <p className="text-[10px] text-surface-500 mt-1.5">
              Alert when FX rate variance exceeds this percentage
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all",
            saved
              ? "bg-success-500 text-white"
              : "bg-primary-500 hover:bg-primary-600 text-white"
          )}
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            "Save Changes"
          )}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tab 4: Team (Placeholder)
// ═══════════════════════════════════════════════════════════════════════

function TeamTab() {
  return (
    <div className="space-y-4">
      {/* Placeholder Banner */}
      <div className="card border-dashed border-surface-300">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-200/60 mb-4">
            <Users className="w-7 h-7 text-surface-500" />
          </div>
          <h3 className="text-base font-semibold text-surface-800 mb-1">
            Team Management Coming Soon
          </h3>
          <p className="text-sm text-surface-500 max-w-sm">
            Invite teammates, assign roles, and manage permissions. This feature
            is currently under development.
          </p>
        </div>
      </div>

      {/* Current Member */}
      <div className="card">
        <h3 className="text-sm font-semibold text-surface-800 mb-4">
          Current Members
        </h3>
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-100/50 border border-surface-200/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700">
              <span className="text-xs font-semibold text-white">DU</span>
            </div>
            <div>
              <p className="text-sm font-medium text-surface-800">Demo User</p>
              <p className="text-xs text-surface-500">demo@mmr.finance</p>
            </div>
          </div>
          <span className="badge bg-primary-500/15 text-primary-400 border border-primary-500/25">
            <Shield className="w-3 h-3" />
            Admin
          </span>
        </div>
      </div>
    </div>
  );
}
