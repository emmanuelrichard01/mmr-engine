'use client';

import { RefreshCw } from 'lucide-react';
import { READINESS_LABEL, readinessState } from '@/components/readiness-indicator';
import { ErrorNotice } from '@/components/notices';
import { PageHeader, SectionHeader, Skeleton } from '@/components/page-header';
import { DEMO_MODE, type ServiceCheck } from '@/lib/api';
import { useReadiness } from '@/lib/hooks';
import { cn, formatTime, humanize } from '@/lib/utils';

const KNOWN_KEYS = new Set(['status', 'latency_ms', 'error']);

function serviceTone(status: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'healthy' || s === 'ok' || s === 'up') return 'ok';
  if (s === 'degraded') return 'warn';
  if (s === 'unhealthy' || s === 'down' || s === 'error') return 'bad';
  return 'neutral';
}

const TONE_BADGE = {
  ok: 'badge-success',
  warn: 'badge-warning',
  bad: 'badge-danger',
  neutral: 'badge-neutral',
} as const;

const STATE_BADGE = {
  checking: 'badge-neutral',
  ready: 'badge-success',
  degraded: 'badge-warning',
  down: 'badge-danger',
  demo: 'badge-warning',
} as const;

function extraFields(check: ServiceCheck): [string, string][] {
  return Object.entries(check)
    .filter(([k]) => !KNOWN_KEYS.has(k))
    .map(([k, v]) => [humanize(k), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
}

export function SystemView() {
  const { data, error, isLoading, isRefreshing, refetch } = useReadiness();
  const state = readinessState(data, error, isLoading);
  const checks = Object.entries(data?.body?.checks ?? {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="System"
        description="Read-only view of the engine’s readiness and how this dashboard is wired to it."
        actions={
          <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
            {isRefreshing ? 'Checking…' : 'Check again'}
          </button>
        }
      />

      {/* Readiness */}
      <section className="card card-flush" aria-labelledby="readiness-heading">
        <div className="card-section">
          <SectionHeader
            id="readiness-heading"
            title="Readiness"
            description={
              <>
                From <code className="text-mono">GET /health/ready</code>, re-checked every 30 seconds.
                {data && ` Last checked ${formatTime(data.checkedAt)}.`}
              </>
            }
            actions={<span className={cn('badge', STATE_BADGE[state])}>{READINESS_LABEL[state]}</span>}
          />
        </div>

        {error ? (
          <div className="card-section pt-0">
            <ErrorNotice error={error} what="the readiness check" />
          </div>
        ) : isLoading ? (
          <div className="card-section space-y-3 pt-0">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : data ? (
          <>
            <dl className="stat-grid card-section pt-0 sm:grid-cols-3">
              <div>
                <dt>HTTP status</dt>
                <dd className="tabular-nums">{data.httpStatus}</dd>
              </div>
              <div>
                <dt>Reported status</dt>
                <dd>{data.body?.status ? humanize(data.body.status) : '—'}</dd>
              </div>
              <div>
                <dt>API version</dt>
                <dd className="text-mono">{data.body?.version ?? '—'}</dd>
              </div>
            </dl>

            {checks.length === 0 ? (
              <p className="card-section pt-0 text-body">The response did not include per-service checks.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <caption className="sr-only">Dependency checks</caption>
                  <thead>
                    <tr>
                      <th scope="col">Dependency</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="text-right">Latency</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map(([name, check]) => {
                      const extras = extraFields(check);
                      return (
                        <tr key={name}>
                          <th scope="row" className="font-medium">
                            {humanize(name)}
                          </th>
                          <td>
                            <span className={cn('badge', TONE_BADGE[serviceTone(String(check.status ?? ''))])}>
                              {humanize(String(check.status ?? 'unknown'))}
                            </span>
                          </td>
                          <td className="text-right tabular-nums">
                            {typeof check.latency_ms === 'number' ? `${check.latency_ms} ms` : '—'}
                          </td>
                          <td className="max-w-[420px] whitespace-normal text-[var(--color-surface-600)]">
                            {check.error && <span className="block text-[var(--color-danger-600)]">{check.error}</span>}
                            {extras.map(([k, v]) => (
                              <span key={k} className="block">
                                {k}: <span className="text-mono">{v}</span>
                              </span>
                            ))}
                            {!check.error && extras.length === 0 && '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <details className="card-section border-t border-[var(--color-surface-200)]">
              <summary className="cursor-pointer text-[13px] font-medium text-[var(--color-surface-700)]">
                Raw response
              </summary>
              <pre className="code-block mt-3">{JSON.stringify(data.body, null, 2)}</pre>
            </details>
          </>
        ) : null}
      </section>

      {/* Configuration */}
      <section className="card" aria-labelledby="config-heading">
        <SectionHeader id="config-heading" title="Configuration" description="Set through environment variables; nothing here is editable from the browser." />
        <dl className="config-list mt-4">
          <div>
            <dt>API access</dt>
            <dd>
              The browser only calls <code className="text-mono">/api/mmr/*</code> on this dashboard. A server-side
              route forwards each request to <code className="text-mono">MMR_API_URL</code> (default{' '}
              <code className="text-mono">http://localhost:8000</code>) and adds{' '}
              <code className="text-mono">X-API-Key</code> from <code className="text-mono">MMR_API_KEY</code> when it is
              set. The key never reaches the browser.
            </dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd>
              {DEMO_MODE ? (
                <>
                  <strong>Demo fixtures.</strong> This build was made with{' '}
                  <code className="text-mono">NEXT_PUBLIC_DEMO_MODE=true</code>, so pages show bundled sample data and
                  resolving is disabled. The readiness above describes the fixtures, not a real engine.
                </>
              ) : (
                <>
                  The MMR API, via the proxy. If a request fails, the page shows the error — there is no fallback to sample data. Demo
                  fixtures are only available in a separate build with{' '}
                  <code className="text-mono">NEXT_PUBLIC_DEMO_MODE=true</code>.
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Tenancy and keys</dt>
            <dd>
              Single-tenant reference system. PSP webhook secrets and the Slack alert destination are configured in
              the API’s environment; there is no key or alert management in this dashboard.
            </dd>
          </div>
          <div>
            <dt>Webhook endpoints</dt>
            <dd>
              PSPs post to the API directly, not through this dashboard:{' '}
              <code className="text-mono">POST /v1/webhooks/paystack</code> and{' '}
              <code className="text-mono">POST /v1/webhooks/flutterwave</code>.
            </dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>API timestamps are UTC; this dashboard displays them in West Africa Time (Africa/Lagos).</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
