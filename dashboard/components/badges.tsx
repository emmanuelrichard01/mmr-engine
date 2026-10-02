import type { DiscrepancyStatus, Severity } from '@/lib/api';
import { cn, humanize } from '@/lib/utils';

// Every badge carries a text label; colour is a secondary cue only.

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'badge-danger',
  high: 'badge-warning',
  medium: 'badge-info',
  low: 'badge-neutral',
};

export function SeverityBadge({ severity, className }: { severity: Severity | null; className?: string }) {
  if (!severity) {
    return (
      <span className={cn('badge badge-outline', className)} title="The engine did not assign a severity">
        Unclassified
      </span>
    );
  }
  return (
    <span className={cn('badge', SEVERITY_CLASS[severity] ?? 'badge-neutral', className)}>
      <span className="badge-dot" aria-hidden="true" />
      {humanize(severity)}
    </span>
  );
}

const STATUS_CLASS: Record<DiscrepancyStatus, string> = {
  open: 'badge-outline',
  under_review: 'badge-info',
  escalated: 'badge-warning',
  resolved: 'badge-success',
  false_positive: 'badge-neutral',
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
    <span className={cn('badge', known ? STATUS_CLASS[status as DiscrepancyStatus] : 'badge-neutral', className)}>
      {known ? STATUS_LABEL[status as DiscrepancyStatus] : humanize(status)}
    </span>
  );
}

export function ExperimentalBadge({ className }: { className?: string }) {
  return <span className={cn('badge badge-warning', className)}>Experimental</span>;
}
