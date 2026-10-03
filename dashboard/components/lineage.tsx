import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TransactionDetailResponse } from '@/lib/api';
import { formatNgn } from '@/lib/money';
import { formatDateTime, formatScore, humanize, shortId, strategyLabel } from '@/lib/utils';
import { StatusBadge } from './badges';
import { CopyButton } from './copy-button';

function Step({ tone, title, layer, children }: { tone?: 'accent' | 'positive' | 'critical' | 'muted'; title: string; layer: string; children: ReactNode }) {
  return (
    <li>
      <span className="timeline-node" data-tone={tone} aria-hidden="true" />
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13.5px] font-semibold text-fg">{title}</p>
        <span className="t-caption shrink-0">{layer}</span>
      </div>
      <div className="mt-1.5 space-y-1 text-[13px] text-fg-muted">{children}</div>
    </li>
  );
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2">
      <span className="text-fg-subtle">{k}</span>
      <span className="min-w-0 text-fg">{children}</span>
    </p>
  );
}

/** From the broker offset to Gold: where this transaction came from and what the engine did with it. */
export function LineageTimeline({ detail }: { detail: TransactionDetailResponse }) {
  const { transaction: t, lineage: l, pair, discrepancies } = detail;
  return (
    <ol className="timeline" aria-label="Lineage">
      <Step tone="accent" title="Received from the PSP" layer="Kafka">
        <KV k="Topic">
          <span className="t-mono">{l.kafka_topic ?? '—'}</span>
        </KV>
        <KV k="Partition / offset">
          <span className="num t-mono">
            {l.kafka_partition ?? '—'} / {l.kafka_offset?.toLocaleString('en-NG') ?? '—'}
          </span>
        </KV>
        <KV k="Event">
          <span className="t-mono">{t.psp_event_type}</span>
        </KV>
      </Step>
      <Step tone="accent" title="Stored raw" layer="Bronze">
        <KV k="Received">{formatDateTime(l.bronze_received_at)}</KV>
        <KV k="Object">
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="t-mono break-all">{l.bronze_file_path ?? '—'}</span>
            {l.bronze_file_path && <CopyButton value={l.bronze_file_path} label="object path" />}
          </span>
        </KV>
      </Step>
      <Step tone="accent" title="Normalised" layer="Silver">
        <KV k="Written">{formatDateTime(t.created_at)}</KV>
        <KV k="Idempotency key">
          <span className="t-mono break-all">{t.idempotency_key}</span>
        </KV>
        {l.run_id && (
          <KV k="Run">
            <span className="t-mono" title={l.run_id}>
              {shortId(l.run_id)}
            </span>
          </KV>
        )}
      </Step>
      {pair ? (
        <Step tone="positive" title={`Matched, ${strategyLabel(pair.match_strategy).toLowerCase()}`} layer="Gold">
          <KV k="Confidence">
            <span className="num">{formatScore(pair.confidence_score)}</span>
          </KV>
          <KV k="Counterpart">
            <Link href={`/transactions?id=${pair.counterpart.id}`} className="t-link t-mono">
              {pair.counterpart.psp_transaction_ref}
            </Link>
          </KV>
          <KV k="Pair">
            <Link href={`/matches?id=${pair.id}`} className="t-link t-mono" title={pair.id}>
              {shortId(pair.id)}
            </Link>
          </KV>
        </Step>
      ) : (
        <Step tone="muted" title="Not matched" layer="Gold">
          <p>No counterpart has been paired with this transaction yet.</p>
        </Step>
      )}
      {discrepancies.length ? (
        <Step tone="critical" title={`${discrepancies.length} discrepanc${discrepancies.length === 1 ? 'y' : 'ies'} raised`} layer="Gold">
          <ul className="space-y-1.5">
            {discrepancies.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/inbox?status=all&id=${d.id}`} className="t-link">
                  {humanize(d.discrepancy_type)}
                </Link>
                <StatusBadge status={d.status} className="h-[18px] px-1.5 text-[11.5px]" />
                <span className="num text-fg-subtle">{formatNgn(d.estimated_exposure_ngn)}</span>
              </li>
            ))}
          </ul>
        </Step>
      ) : (
        <Step tone="positive" title="No discrepancies" layer="Gold">
          <p>The engine raised nothing against this transaction.</p>
        </Step>
      )}
    </ol>
  );
}
