import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// ─── Class Name Utility ───────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Currency Formatting ──────────────────────────────────────────────────────

const currencySymbols: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  KES: 'KSh',
};

export function formatCurrency(
  amount: number,
  currency: string = 'NGN'
): string {
  const symbol = currencySymbols[currency] ?? currency;
  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (absAmount >= 1_000_000_000) {
    return `${sign}${symbol}${(absAmount / 1_000_000_000).toFixed(2)}B`;
  }
  if (absAmount >= 1_000_000) {
    return `${sign}${symbol}${(absAmount / 1_000_000).toFixed(2)}M`;
  }

  return `${sign}${symbol}${absAmount.toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatCurrencyFull(
  amount: number,
  currency: string = 'NGN'
): string {
  const symbol = currencySymbols[currency] ?? currency;
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// ─── Percent Formatting ──────────────────────────────────────────────────────

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ─── Relative Time ────────────────────────────────────────────────────────────

export function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60)
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  if (diffHours < 24)
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30)
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString('en-NG');
}

// Alias for backward compat — accepts Date | string
export function timeAgo(date: Date | string): string {
  const dateStr = date instanceof Date ? date.toISOString() : date;
  return getRelativeTime(dateStr);
}

// ─── Severity Color Classes ───────────────────────────────────────────────────

export function getSeverityColor(severity: string): {
  bg: string;
  text: string;
  dot: string;
  badge: string;
} {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-danger-500/15',
        text: 'text-danger-400',
        dot: 'bg-danger-400',
        badge: 'badge-critical',
      };
    case 'high':
      return {
        bg: 'bg-warning-500/15',
        text: 'text-warning-400',
        dot: 'bg-warning-400',
        badge: 'badge-high',
      };
    case 'medium':
      return {
        bg: 'bg-primary-500/15',
        text: 'text-primary-400',
        dot: 'bg-primary-400',
        badge: 'badge-medium',
      };
    case 'low':
      return {
        bg: 'bg-success-500/15',
        text: 'text-success-400',
        dot: 'bg-success-400',
        badge: 'badge-low',
      };
    default:
      return {
        bg: 'bg-surface-300/15',
        text: 'text-surface-600',
        dot: 'bg-surface-500',
        badge: 'badge-low',
      };
  }
}

// ─── Status Color Classes ─────────────────────────────────────────────────────

export function getStatusColor(status: string): {
  bg: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case 'connected':
      return {
        bg: 'bg-success-500/15',
        text: 'text-success-400',
        dot: 'bg-success-400',
      };
    case 'degraded':
      return {
        bg: 'bg-warning-500/15',
        text: 'text-warning-400',
        dot: 'bg-warning-400',
      };
    case 'disconnected':
      return {
        bg: 'bg-danger-500/15',
        text: 'text-danger-400',
        dot: 'bg-danger-400',
      };
    default:
      return {
        bg: 'bg-surface-300/15',
        text: 'text-surface-500',
        dot: 'bg-surface-500',
      };
  }
}

// ─── Number Formatting ────────────────────────────────────────────────────────

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-NG');
}
