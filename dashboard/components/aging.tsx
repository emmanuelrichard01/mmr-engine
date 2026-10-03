'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { AgingBucket, AgingBucketRow } from '@/lib/api';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { formatKobo, koboRatio, sumKobo, toKobo } from '@/lib/money';
import { cn, formatCount } from '@/lib/utils';

export const BUCKET_LABEL: Record<AgingBucket, string> = {
  '0-1d': 'Under 1 day',
  '1-3d': '1 to 3 days',
  '3-7d': '3 to 7 days',
  '7d+': 'Over 7 days',
};

const BUCKET_FILL: Record<AgingBucket, string> = {
  '0-1d': 'bg-age-1',
  '1-3d': 'bg-age-2',
  '3-7d': 'bg-age-3',
  '7d+': 'bg-age-4',
};

/**
 * One stacked bar of open exposure by age. Widths come from integer-kobo
 * ratios; a bucket with exposure but a tiny share still gets a visible sliver.
 */
export function AgingBar({ buckets, className, label }: { buckets: AgingBucketRow[]; className?: string; label: string }) {
  const reduce = useReducedMotion();
  const total = sumKobo(buckets.map((b) => b.exposure_ngn));
  const parts = buckets.map((b) => {
    const kobo = toKobo(b.exposure_ngn) ?? BigInt(0);
    return { ...b, kobo, share: koboRatio(kobo, total) };
  });
  const description = parts.map((p) => `${BUCKET_LABEL[p.bucket]}: ${formatKobo(p.kobo)}`).join(', ');

  return (
    <div role="img" aria-label={`${label}. ${description}.`} className={cn('flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-inset', className)}>
      {total > BigInt(0) &&
        parts
          .filter((p) => p.kobo > BigInt(0))
          .map((p, i) => (
            <motion.span
              key={p.bucket}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', BUCKET_FILL[p.bucket])}
              style={{ flexGrow: Math.max(p.share, 0.012), flexBasis: 0, transformOrigin: 'left center' }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: DURATION.reveal, ease: EASE_OUT, delay: i * 0.05 }}
            />
          ))}
    </div>
  );
}

export function AgingLegend({ buckets }: { buckets: AgingBucketRow[] }) {
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">Open exposure by age</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Age</th>
          <th scope="col">Open</th>
          <th scope="col">Exposure</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.bucket} className="border-t border-line first:border-t-0">
            <th scope="row" className="py-2.5 text-left font-normal text-fg-muted">
              <span className="flex items-center gap-2.5">
                <span className={cn('h-2.5 w-2.5 rounded-[3px]', BUCKET_FILL[b.bucket])} aria-hidden="true" />
                {BUCKET_LABEL[b.bucket]}
              </span>
            </th>
            <td className="num py-2.5 text-right text-fg-subtle">{formatCount(b.count)}</td>
            <td className="num w-[45%] py-2.5 text-right font-medium text-fg">{formatKobo(toKobo(b.exposure_ngn) ?? BigInt(0))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
