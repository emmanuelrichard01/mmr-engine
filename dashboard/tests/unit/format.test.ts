import { describe, expect, it } from 'vitest';
import {
  flowLabel,
  formatAge,
  formatCalendarDate,
  formatCount,
  formatDateTime,
  formatDuration,
  formatGap,
  formatPercent,
  formatPointsDelta,
  formatScore,
  formatShortDateTime,
  formatTime,
  humanize,
  lagosDate,
  parseScore,
  pspDisplayName,
  shortId,
  strategyLabel,
} from '@/lib/utils';

describe('numbers', () => {
  it('shows a dash for missing rates', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(97.456)).toBe('97.5%');
    expect(formatPercent(97.456, 2)).toBe('97.46%');
  });

  it('formats counts and deltas', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(null)).toBe('—');
    expect(formatPointsDelta(0.04)).toBe('0.0 pp');
    expect(formatPointsDelta(1.26)).toBe('+1.3 pp');
    expect(formatPointsDelta(-0.5)).toBe('−0.5 pp');
  });

  it('parses confidence scores from strings or numbers', () => {
    expect(parseScore('0.8732')).toBeCloseTo(0.8732);
    expect(parseScore(1)).toBe(1);
    expect(parseScore('x')).toBeNull();
    expect(parseScore(null)).toBeNull();
    expect(formatScore('0.8732')).toBe('87.3%');
    expect(formatScore(null)).toBe('—');
  });

  it('formats durations and gaps', () => {
    expect(formatDuration(0.84)).toBe('0.8s');
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(185)).toBe('3m 05s');
    expect(formatDuration(8040)).toBe('2h 14m');
    expect(formatDuration(null)).toBe('—');
    expect(formatGap(41)).toBe('41s');
    expect(formatGap(720)).toBe('12m');
    expect(formatGap(12_000)).toBe('3h 20m');
    expect(formatGap(187_200)).toBe('2d 4h');
  });
});

describe('dates in Africa/Lagos (UTC+1, no DST)', () => {
  it('converts UTC instants to WAT', () => {
    expect(formatDateTime('2026-10-02T13:05:00Z')).toBe('2 Oct 2026, 14:05 WAT');
    expect(formatShortDateTime('2026-10-02T23:30:00Z')).toBe('3 Oct, 00:30');
    expect(formatTime('2026-10-02T13:05:09Z')).toBe('14:05:09 WAT');
    expect(formatDateTime('nonsense')).toBe('—');
  });

  it('uses the Lagos calendar day, not the UTC one', () => {
    expect(lagosDate('2026-10-02T23:30:00Z')).toBe('2026-10-03');
    expect(lagosDate('2026-10-02T22:59:59Z')).toBe('2026-10-02');
  });

  it('formats business dates without timezone conversion', () => {
    expect(formatCalendarDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatCalendarDate('2026-10-01', false)).toBe('1 Oct');
  });

  it('formats ages from a supplied clock', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(formatAge('2026-10-03T11:59:40Z', now)).toBe('<1m');
    expect(formatAge('2026-10-03T11:15:00Z', now)).toBe('45m');
    expect(formatAge('2026-10-03T06:00:00Z', now)).toBe('6h');
    expect(formatAge('2026-09-30T12:00:00Z', now)).toBe('3d');
    expect(formatAge('2026-10-03T06:00:00Z', null)).toBe('—');
  });
});

describe('labels', () => {
  it('humanizes enum values', () => {
    expect(humanize('fx_variance')).toBe('FX variance');
    expect(humanize('missing_settlement')).toBe('Missing settlement');
    expect(humanize(null)).toBe('—');
  });

  it('names PSPs, flows and strategies', () => {
    expect(pspDisplayName('paystack')).toBe('Paystack');
    expect(pspDisplayName('moniepoint')).toBe('Moniepoint');
    expect(flowLabel('silver-to-gold-matching-flow')).toBe('Matching');
    expect(flowLabel('some-new-flow')).toBe('Some new');
    expect(strategyLabel('probabilistic_secondary')).toBe('Probabilistic');
  });

  it('shortens ids for display', () => {
    expect(shortId('3f2a1b4c-0000-4000-8000-00000000c1d9')).toBe('3f2a1b4c…c1d9');
    expect(shortId('short')).toBe('short');
  });
});
