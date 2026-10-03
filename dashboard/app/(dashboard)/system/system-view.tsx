'use client';

import { RotateCw } from 'lucide-react';
import { READINESS_DOT, READINESS_LABEL, readinessState } from '@/components/readiness-indicator';
import { ErrorNotice } from '@/components/notices';
import { PageHeader, SectionHeader, Skeleton } from '@/components/page-header';
import { Reveal } from '@/components/motion-primitives';
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

const TONE_BADGE = { ok: 'badge-positive', warn: 'badge-medium', bad: 'badge-critical', neutral: '' } as const;
const TONE_DOT = { ok: 'dot-ok', warn: 'dot-warn', bad: 'dot-bad', neutral: '' } as const;

function extraFields(check: ServiceCheck): [string, string][] {
  return Object.entries(check)
    .filter(([k]) => !KNOWN_KEYS.has(k))
    .map(([k, v]) => [humanize(k), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
}

const HEADLINE: Record<string, string> = {
  checking: 'Checking the engine',
  ready: 'Every dependency is ready',
  degraded: 'The engine is degraded',
  down: 'The engine cannot be reached',
  demo: 'Demo fixtures, no engine',
};

export function SystemView() {
  const { data, error, isLoading, isRefreshing, refetch } = useReadiness();
  const state = readinessState(data, error, isLoading);
  const checks = Object.entries(data?.body?.checks ?? {});

  return (
    <div className="page space-y-6">
      <PageHeader
        title="System"
        description="Engine readiness and how this dashboard reaches it. Read-only."
        actions={
          <button type="button" onClick={refetch} disabled={isRefreshing} className="btn btn-secondary btn-sm">
            <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden="true" />
            {isRefreshing ? 'Checking' : 'Check again'}
          </button>
        }
      />

      <section className="panel overflow-hidden" aria-labelledby="readiness-heading">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-inset" aria-hidden="true">
              <span className={cn('dot h-2.5 w-2.5', READINESS_DOT[state], state === 'checking' && 'dot-live')} />
            </span>
            <div>
              <h2 id="readiness-heading" className="t-display text-[22px]">
                {HEADLINE[state]}
              </h2>
              <p className="t-caption mt-1">
                From <code className="t-mono">GET /health/ready</code>, re-checked every 30 seconds{data ? `. Last checked ${formatTime(data.checkedAt)}.` : '.'}
              </p>
            </div>
          </div>
          <span className="t-label">{READINESS_LABEL[state]}</span>
        </div>

        {error ? (
          <div className="px-6 pb-6">
            <ErrorNotice error={error} what="the readiness check" onRetry={refetch} retrying={isRefreshing} />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 border-t border-line px-6 py-5" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : data ? (
          <>
            <dl className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
              {[
                ['HTTP status', String(data.httpStatus)],
                ['Reported status', data.body?.status ? humanize(data.body.status) : '—'],
                ['API version', data.body?.version ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel px-6 py-4">
                  <dt className="t-caption">{k}</dt>
                  <dd className="num mt-1 text-[14px] font-medium text-fg">{v}</dd>
                </div>
              ))}
            </dl>

            {checks.length === 0 ? (
              <p className="t-body border-t border-line px-6 py-5 text-[13px]">The response did not include per-dependency checks.</p>
            ) : (
              <ul className="border-t border-line">
                {checks.map(([name, check]) => {
                  const tone = serviceTone(String(check.status ?? ''));
                  const extras = extraFields(check);
                  return (
                    <li key={name} className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-line px-6 py-4 last:border-b-0 sm:grid-cols-[180px_1fr_auto]">
                      <span className="flex items-center gap-2.5 text-[14px] font-medium text-fg">
                        <span className={cn('dot', TONE_DOT[tone])} aria-hidden="true" />
                        {humanize(name)}
                      </span>
                      <span className="col-span-2 text-[13px] text-fg-muted sm:col-span-1 sm:row-start-1 sm:col-start-2">
                        {check.error && <span className={cn('block', tone === 'bad' && 'text-critical-text')}>{check.error}</span>}
                        {extras.map(([k, v]) => (
                          <span key={k} className="block">
                            {k}: <span className="t-mono">{v}</span>
                          </span>
                        ))}
                        {!check.error && extras.length === 0 && (typeof check.latency_ms === 'number' ? `Responded in ${check.latency_ms} ms` : 'No details')}
                      </span>
                      <span className={cn('badge row-start-1 justify-self-end sm:col-start-3', TONE_BADGE[tone])}>{humanize(String(check.status ?? 'unknown'))}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            <details className="border-t border-line px-6 py-4">
              <summary className="t-label cursor-pointer select-none hover:text-fg">Raw response</summary>
              <pre className="code-block mt-3">{JSON.stringify(data.body, null, 2)}</pre>
            </details>
          </>
        ) : null}
      </section>

      <Reveal as="section" className="panel" >
        <div className="px-6 pt-5">
          <SectionHeader id="config-heading" title="How this dashboard is wired" description="Set through environment variables; nothing here is editable from the browser." />
        </div>
        <dl className="dl-rows px-6 pb-3 pt-3 [&>div]:py-3.5">
          <div>
            <dt>API access</dt>
            <dd className="leading-relaxed">
              The browser only calls <code className="t-mono">/api/mmr/*</code> on this dashboard. A server-side route forwards an allow-list of read and resolve routes to{' '}
              <code className="t-mono">MMR_API_URL</code> and adds <code className="t-mono">X-API-Key</code> from <code className="t-mono">MMR_API_KEY</code>. The key never reaches the browser.
            </dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd className="leading-relaxed">
              {DEMO_MODE ? (
                <>
                  <strong>Demo fixtures.</strong> This build was made with <code className="t-mono">NEXT_PUBLIC_DEMO_MODE=true</code>: every page shows data generated in the browser, and resolutions change only this tab.
                </>
              ) : (
                <>The MMR API, through the proxy. A failed request shows the error; there is no fallback to sample data.</>
              )}
            </dd>
          </div>
          <div>
            <dt>Tenancy and keys</dt>
            <dd className="leading-relaxed">Single-tenant reference system. PSP webhook secrets and the Slack alert destination live in the API’s environment.</dd>
          </div>
          <div>
            <dt>Webhook endpoints</dt>
            <dd className="leading-relaxed">
              PSPs post to the API directly: <code className="t-mono">POST /v1/webhooks/paystack</code> and <code className="t-mono">POST /v1/webhooks/flutterwave</code>.
            </dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd className="leading-relaxed">API timestamps are UTC. This dashboard shows them in West Africa Time (Africa/Lagos, UTC+1).</dd>
          </div>
        </dl>
      </Reveal>
    </div>
  );
}
