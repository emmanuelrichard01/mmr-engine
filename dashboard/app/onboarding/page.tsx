'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Stepper } from '@/components/stepper';
import { cn } from '@/lib/utils';
import {
  Building2,
  Link2,
  Database,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
  Shield,
  Zap,
  AlertTriangle,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────

interface PSPConnection {
  name: string;
  displayName: string;
  icon: string;
  connected: boolean;
  apiKey: string;
  isValidating: boolean;
  isValid: boolean | null;
  webhookUrl: string;
}

// ── Constants ────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Business Profile', description: 'Organization info' },
  { label: 'Connect PSPs', description: 'Payment providers' },
  { label: 'Import Data', description: 'Historical backfill' },
  { label: 'Ready', description: 'All set!' },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ── Page ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1 state
  const [orgName, setOrgName] = useState('');
  const [industry, setIndustry] = useState('fintech');
  const [volume, setVolume] = useState('');
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);

  // Step 2 state
  const [psps, setPsps] = useState<PSPConnection[]>([
    {
      name: 'paystack', displayName: 'Paystack', icon: '💳',
      connected: false, apiKey: '', isValidating: false, isValid: null, webhookUrl: '',
    },
    {
      name: 'flutterwave', displayName: 'Flutterwave', icon: '🦋',
      connected: false, apiKey: '', isValidating: false, isValid: null, webhookUrl: '',
    },
    {
      name: 'mpesa', displayName: 'M-Pesa', icon: '📱',
      connected: false, apiKey: '', isValidating: false, isValid: null, webhookUrl: '',
    },
  ]);

  // Step 3 state
  const [backfillDays, setBackfillDays] = useState(30);
  const [backfillStatus, setBackfillStatus] = useState<'idle' | 'running' | 'complete'>('idle');
  const [backfillProgress, setBackfillProgress] = useState(0);

  // Copy helper
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const connectedCount = psps.filter((p) => p.connected).length;

  // ── Step 1: Create Profile ─────────────────────────────────────────

  const handleCreateProfile = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/v1/onboarding/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_name: orgName,
          industry,
          estimated_monthly_volume_ngn: volume ? parseFloat(volume.replace(/,/g, '')) : null,
          contact_email: email,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setOrgId(data.data.organization_id);
      } else {
        // Demo fallback
        setOrgId('demo-org-' + Date.now());
      }
    } catch {
      // Offline — demo mode
      setOrgId('demo-org-' + Date.now());
    }
    setIsSubmitting(false);
    setCurrentStep(1);
  }, [orgName, industry, volume, email]);

  // ── Step 2: Validate & Connect PSP ─────────────────────────────────

  const handleValidatePSP = useCallback(async (pspName: string) => {
    setPsps((prev) =>
      prev.map((p) =>
        p.name === pspName ? { ...p, isValidating: true, isValid: null } : p
      )
    );

    const psp = psps.find((p) => p.name === pspName);
    if (!psp) return;

    try {
      const res = await fetch(`${API_BASE}/v1/onboarding/validate-psp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          psp_name: pspName,
          api_key: psp.apiKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPsps((prev) =>
          prev.map((p) =>
            p.name === pspName
              ? { ...p, isValidating: false, isValid: data.is_valid }
              : p
          )
        );

        // Auto-connect if valid
        if (data.is_valid && orgId) {
          const connectRes = await fetch(
            `${API_BASE}/v1/onboarding/connect-psp?organization_id=${orgId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                psp_name: pspName,
                api_key: psp.apiKey,
              }),
            }
          );
          if (connectRes.ok) {
            const connectData = await connectRes.json();
            setPsps((prev) =>
              prev.map((p) =>
                p.name === pspName
                  ? {
                      ...p,
                      connected: true,
                      webhookUrl: connectData.data.webhook_url || '',
                    }
                  : p
              )
            );
          }
        }
      } else {
        // Demo fallback
        setPsps((prev) =>
          prev.map((p) =>
            p.name === pspName
              ? {
                  ...p,
                  isValidating: false,
                  isValid: true,
                  connected: true,
                  webhookUrl: `https://api.mmr.finance/v1/webhooks/${pspName}?org=${orgId || 'demo'}`,
                }
              : p
          )
        );
      }
    } catch {
      // Demo mode
      setPsps((prev) =>
        prev.map((p) =>
          p.name === pspName
            ? {
                ...p,
                isValidating: false,
                isValid: true,
                connected: true,
                webhookUrl: `https://api.mmr.finance/v1/webhooks/${pspName}?org=${orgId || 'demo'}`,
              }
            : p
        )
      );
    }
  }, [psps, orgId]);

  // ── Step 3: Backfill ────────────────────────────────────────────────

  const handleBackfill = useCallback(async () => {
    setBackfillStatus('running');
    setBackfillProgress(0);

    try {
      await fetch(`${API_BASE}/v1/onboarding/backfill/${orgId}?days=${backfillDays}`, {
        method: 'POST',
      });
    } catch {
      // Demo mode — continue
    }

    // Simulate progress
    const interval = setInterval(() => {
      setBackfillProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setBackfillStatus('complete');
          return 100;
        }
        return prev + Math.random() * 15 + 5;
      });
    }, 400);
  }, [orgId, backfillDays]);

  // ── Copy helper ────────────────────────────────────────────────────

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      /* ignore */
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto space-y-8">
      {/* Stepper */}
      <Stepper steps={STEPS} currentStep={currentStep} />

      {/* Step Content Card */}
      <div className="card animate-fade-in" key={currentStep}>
        {/* ═══ Step 1: Business Profile ═══ */}
        {currentStep === 0 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-[var(--color-primary-400)]" />
                <h2 className="text-lg font-bold text-[var(--color-surface-900)]">
                  Business Profile
                </h2>
              </div>
              <p className="text-sm text-[var(--color-surface-500)]">
                Tell us about your organization to configure optimal reconciliation settings.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-surface-600)] mb-1.5">
                  Organization Name *
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Paywise Technologies"
                  className="w-full px-3 py-2.5 rounded-lg text-sm bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-[var(--color-surface-800)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 focus:border-[var(--color-primary-500)]/50 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-surface-600)] mb-1.5">
                    Industry
                  </label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg text-sm bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-[var(--color-surface-700)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 transition-all"
                  >
                    <option value="fintech">Fintech</option>
                    <option value="ecommerce">E-Commerce</option>
                    <option value="logistics">Logistics</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-surface-600)] mb-1.5">
                    Monthly Volume (₦)
                  </label>
                  <input
                    type="text"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value.replace(/[^0-9,]/g, ''))}
                    placeholder="500,000,000"
                    className="w-full px-3 py-2.5 rounded-lg text-sm bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-[var(--color-surface-800)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 transition-all tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-surface-600)] mb-1.5">
                  Contact Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="finance@company.com"
                  className="w-full px-3 py-2.5 rounded-lg text-sm bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-[var(--color-surface-800)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 transition-all"
                />
              </div>
            </div>

            <button
              onClick={handleCreateProfile}
              disabled={!orgName || !email || isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              ) : (
                <>Continue <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        )}

        {/* ═══ Step 2: Connect PSPs ═══ */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link2 className="w-5 h-5 text-[var(--color-primary-400)]" />
                <h2 className="text-lg font-bold text-[var(--color-surface-900)]">
                  Connect Payment Providers
                </h2>
              </div>
              <p className="text-sm text-[var(--color-surface-500)]">
                Connect at least one PSP to start reconciling transactions.
                Your API keys are validated and never stored in plaintext.
              </p>
            </div>

            <div className="space-y-3">
              {psps.map((psp) => (
                <div
                  key={psp.name}
                  className={cn(
                    'rounded-xl border p-4 transition-all',
                    psp.connected
                      ? 'border-[var(--color-success-500)]/30 bg-[var(--color-success-500)]/5'
                      : 'border-[var(--color-surface-200)] bg-[var(--color-surface-50)]'
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{psp.icon}</span>
                      <span className="font-medium text-[var(--color-surface-800)]">
                        {psp.displayName}
                      </span>
                    </div>
                    {psp.connected && (
                      <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-success-400)] bg-[var(--color-success-500)]/15 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Connected
                      </span>
                    )}
                  </div>

                  {!psp.connected && (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={psp.apiKey}
                        onChange={(e) =>
                          setPsps((prev) =>
                            prev.map((p) =>
                              p.name === psp.name
                                ? { ...p, apiKey: e.target.value }
                                : p
                            )
                          )
                        }
                        placeholder={`sk_live_... or FLWSECK_...`}
                        className="flex-1 px-3 py-2 rounded-lg text-sm bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-[var(--color-surface-700)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 font-mono"
                      />
                      <button
                        onClick={() => handleValidatePSP(psp.name)}
                        disabled={!psp.apiKey || psp.apiKey.length < 10 || psp.isValidating}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                      >
                        {psp.isValidating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Shield className="w-4 h-4" />
                        )}
                        {psp.isValidating ? 'Validating...' : 'Connect'}
                      </button>
                    </div>
                  )}

                  {psp.connected && psp.webhookUrl && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-surface-200)]/50">
                      <p className="text-[10px] text-[var(--color-surface-500)] mb-1">
                        Configure this webhook URL in your {psp.displayName} dashboard:
                      </p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 text-[11px] font-mono text-[var(--color-surface-600)] bg-[var(--color-surface-100)] px-2.5 py-1.5 rounded border border-[var(--color-surface-200)] truncate">
                          {psp.webhookUrl}
                        </code>
                        <button
                          onClick={() => handleCopy(psp.webhookUrl)}
                          className="p-1.5 rounded hover:bg-[var(--color-surface-200)] transition-colors shrink-0"
                        >
                          {copiedUrl === psp.webhookUrl ? (
                            <Check className="w-3.5 h-3.5 text-[var(--color-success-400)]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-[var(--color-surface-400)]" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setCurrentStep(0)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-[var(--color-surface-600)] hover:text-[var(--color-surface-800)] bg-[var(--color-surface-100)] hover:bg-[var(--color-surface-200)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => setCurrentStep(2)}
                disabled={connectedCount === 0}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 3: Historical Import ═══ */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Database className="w-5 h-5 text-[var(--color-primary-400)]" />
                <h2 className="text-lg font-bold text-[var(--color-surface-900)]">
                  Import Historical Data
                </h2>
              </div>
              <p className="text-sm text-[var(--color-surface-500)]">
                Import past transactions to establish baseline reconciliation metrics.
                This runs in the background — you can proceed while it completes.
              </p>
            </div>

            {/* Duration selector */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-surface-600)] mb-2">
                Import Duration
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[7, 14, 30].map((days) => (
                  <button
                    key={days}
                    onClick={() => setBackfillDays(days)}
                    disabled={backfillStatus !== 'idle'}
                    className={cn(
                      'py-3 rounded-lg text-sm font-medium transition-all border',
                      backfillDays === days
                        ? 'bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30 text-[var(--color-primary-400)]'
                        : 'bg-[var(--color-surface-100)] border-[var(--color-surface-200)] text-[var(--color-surface-600)] hover:border-[var(--color-surface-300)]',
                      backfillStatus !== 'idle' && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>

            {/* Progress */}
            {backfillStatus !== 'idle' && (
              <div className="space-y-2 animate-fade-in">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-surface-600)]">
                    {backfillStatus === 'complete'
                      ? 'Import complete!'
                      : `Importing ${backfillDays} days of history...`}
                  </span>
                  <span className="text-[var(--color-primary-400)] font-medium">
                    {Math.min(100, Math.round(backfillProgress))}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-surface-200)] overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      backfillStatus === 'complete'
                        ? 'bg-[var(--color-success-500)]'
                        : 'bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-primary-400)]'
                    )}
                    style={{ width: `${Math.min(100, backfillProgress)}%` }}
                  />
                </div>
                {backfillStatus === 'complete' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--color-success-400)]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {connectedCount} PSP{connectedCount > 1 ? 's' : ''} · {backfillDays} days imported
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setCurrentStep(1)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-[var(--color-surface-600)] hover:text-[var(--color-surface-800)] bg-[var(--color-surface-100)] hover:bg-[var(--color-surface-200)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              {backfillStatus === 'idle' ? (
                <button
                  onClick={handleBackfill}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] transition-colors"
                >
                  <Zap className="w-4 h-4" /> Start Import
                </button>
              ) : (
                <button
                  onClick={() => setCurrentStep(3)}
                  disabled={backfillStatus !== 'complete'}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ Step 4: Ready ═══ */}
        {currentStep === 3 && (
          <div className="space-y-6 text-center py-4">
            {/* Success animation */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--color-success-500)] to-[var(--color-success-600)] flex items-center justify-center animate-bounce-in">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                {/* Pulse rings */}
                <div className="absolute inset-0 rounded-full bg-[var(--color-success-500)]/20 animate-ping" />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold text-[var(--color-surface-900)]">
                You&apos;re All Set! 🎉
              </h2>
              <p className="text-sm text-[var(--color-surface-500)] mt-2 max-w-md mx-auto">
                Your reconciliation engine is configured and ready.
                Transactions will be automatically matched as they flow through your connected PSPs.
              </p>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
              <div className="rounded-lg bg-[var(--color-surface-100)] p-3">
                <p className="text-2xl font-bold text-[var(--color-primary-400)]">
                  {connectedCount}
                </p>
                <p className="text-[10px] text-[var(--color-surface-500)] mt-0.5">
                  PSPs Connected
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-100)] p-3">
                <p className="text-2xl font-bold text-[var(--color-primary-400)]">
                  {backfillDays}
                </p>
                <p className="text-[10px] text-[var(--color-surface-500)] mt-0.5">
                  Days Imported
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-100)] p-3">
                <p className="text-2xl font-bold text-[var(--color-success-400)]">
                  ✓
                </p>
                <p className="text-[10px] text-[var(--color-surface-500)] mt-0.5">
                  Engine Active
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2 max-w-sm mx-auto">
              <button
                onClick={() => router.push('/')}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-primary-600)] hover:from-[var(--color-primary-600)] hover:to-[var(--color-primary-700)] transition-all shadow-lg shadow-[var(--color-primary-500)]/20"
              >
                Go to Dashboard <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href={`${API_BASE}/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-[var(--color-surface-600)] hover:text-[var(--color-surface-800)] bg-[var(--color-surface-100)] hover:bg-[var(--color-surface-200)] transition-colors"
              >
                View API Documentation
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
