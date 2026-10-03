import type { DiscrepancyStatus, Severity } from '@/lib/api';
import { cn, humanize } from '@/lib/utils';

// Every badge carries a text label; colour is a secondary cue only.

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'badge-critical',
  high: 'badge-high',
  medium: 'badge-medium',
  low: '',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function SeverityPip({ severity, className }: { severity: Severity | null; className?: string }) {
  return <span aria-hidden="true" className={cn('pip', severity ? `pip-${severity}` : 'pip-none', className)} />;
}

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-critical-text',
  high: 'text-high-text',
  medium: 'text-medium-text',
  low: 'text-fg-subtle',
};

/** Compact severity word for dense rows, so severity never relies on the pip's colour alone. */
export function SeverityLabel({ severity, className }: { severity: Severity | null; className?: string }) {
  return (
    <span className={cn('shrink-0 text-[12px] font-medium', severity ? SEVERITY_TEXT[severity] : 'text-fg-subtle', className)}>
      {severity ? SEVERITY_LABEL[severity] : 'Unclassified'}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: Severity | null; className?: string }) {
  if (!severity) {
    return (
      <span className={cn('badge badge-outline', className)} title="The engine did not assign a severity">
        Unclassified
      </span>
    );
  }
  return (
    <span className={cn('badge', SEVERITY_BADGE[severity], className)}>
      <SeverityPip severity={severity} className="h-[7px] w-[7px]" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

const STATUS_CLASS: Record<DiscrepancyStatus, string> = {
  open: 'badge-outline',
  under_review: 'badge-accent',
  escalated: 'badge-high',
  resolved: 'badge-positive',
  false_positive: '',
};

export const STATUS_LABEL: Record<DiscrepancyStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  escalated: 'Escalated',
  resolved: 'Resolved',
  false_positive: 'False positive',
};

export function StatusBadge({ status, className }: { status: DiscrepancyStatus | string; className?: string }) {
  const known = status in STATUS_CLASS;
  return (
    <span className={cn('badge', known ? STATUS_CLASS[status as DiscrepancyStatus] : '', className)}>
      {known ? STATUS_LABEL[status as DiscrepancyStatus] : humanize(status)}
    </span>
  );
}

const PAIR_STATUS_CLASS: Record<string, string> = {
  // Only states that need attention carry colour.
  matched: '',
  discrepancy: 'badge-high',
  under_review: 'badge-accent',
  resolved: 'badge-positive',
  false_positive: '',
};

export function PairStatusBadge({ status, className }: { status: string; className?: string }) {
  return <span className={cn('badge', PAIR_STATUS_CLASS[status] ?? '', className)}>{humanize(status)}</span>;
}

const SETTLEMENT_CLASS: Record<string, string> = {
  settled: '',
  pending: 'badge-medium',
  failed: 'badge-critical',
  reversed: '',
  disputed: 'badge-high',
};

export function SettlementBadge({ status, className }: { status: string; className?: string }) {
  return <span className={cn('badge', SETTLEMENT_CLASS[status] ?? '', className)}>{humanize(status)}</span>;
}

export function MatchBadge({ status, className }: { status: 'matched' | 'unmatched' | string; className?: string }) {
  return (
    <span className={cn('badge', status === 'matched' ? 'badge-accent' : 'badge-outline', className)}>
      {status === 'matched' ? 'Matched' : 'Unmatched'}
    </span>
  );
}

const RUN_CLASS: Record<string, string> = {
  running: 'badge-accent',
  completed: 'badge-positive',
  failed: 'badge-critical',
  cancelled: '',
};

export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  // The normal outcome is plain text; colour is kept for running and failed runs.
  if (status === 'completed') {
    return (
      <span className={cn('inline-flex h-[22px] items-center gap-1.5 text-[12.5px] text-fg-muted', className)}>
        <span className="dot dot-ok h-1.5 w-1.5" aria-hidden="true" />
        Completed
      </span>
    );
  }
  return (
    <span className={cn('badge', RUN_CLASS[status] ?? '', className)}>
      {status === 'running' && <span className="dot dot-live h-1.5 w-1.5" aria-hidden="true" />}
      {humanize(status)}
    </span>
  );
}

export function ExperimentalBadge({ className }: { className?: string }) {
  return <span className={cn('badge badge-medium', className)}>Experimental</span>;
}
