import { describe, expect, it } from 'vitest';
import {
  formatAmountIn,
  formatKobo,
  formatKoboCompact,
  formatNgn,
  interpolateKobo,
  koboParts,
  koboRatio,
  koboToDecimalString,
  maxKobo,
  sumKobo,
  toKobo,
} from '@/lib/money';

const k = (n: number) => BigInt(n);

describe('toKobo', () => {
  it('parses plain decimals exactly', () => {
    expect(toKobo('50000.00')).toBe(k(5_000_000));
    expect(toKobo('0.1')).toBe(k(10));
    expect(toKobo('12')).toBe(k(1200));
    expect(toKobo('-12.5')).toBe(k(-1250));
    expect(toKobo('+3.07')).toBe(k(307));
  });

  it('handles values a float cannot represent', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in kobo it is exact.
    expect(sumKobo(['0.10', '0.20'])).toBe(toKobo('0.30'));
    expect(toKobo('90071992547409.93')).toBe(BigInt('9007199254740993'));
  });

  it('rounds a third fractional digit half away from zero', () => {
    expect(toKobo('1.005')).toBe(k(101));
    expect(toKobo('1.004')).toBe(k(100));
    expect(toKobo('-1.005')).toBe(k(-101));
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', 'abc', '1e5', '1,000.00', '₦100', '1.2.3', null, undefined]) {
      expect(toKobo(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe('formatting', () => {
  it('formats naira with grouping and two decimals', () => {
    expect(formatKobo(k(123_456_789))).toBe('₦1,234,567.89');
    expect(formatKobo(k(5))).toBe('₦0.05');
    expect(formatKobo(k(-1250))).toBe('−₦12.50');
    expect(formatNgn('250000.00')).toBe('₦250,000.00');
    expect(formatNgn(null)).toBe('—');
    expect(formatNgn('not money')).toBe('—');
  });

  it('splits parts so the sign can be set apart', () => {
    expect(koboParts(k(123_456_789))).toEqual({ sign: '', symbol: '₦', whole: '1,234,567', fraction: '89' });
    expect(koboParts(k(-7))).toEqual({ sign: '−', symbol: '₦', whole: '0', fraction: '07' });
  });

  it('compacts large amounts by truncation, never rounding up', () => {
    expect(formatKoboCompact(k(0))).toBe('₦0');
    expect(formatKoboCompact(k(99_900))).toBe('₦999');
    expect(formatKoboCompact(k(150_000))).toBe('₦1.5K');
    expect(formatKoboCompact(k(199_999_999))).toBe('₦1.9M');
    expect(formatKoboCompact(k(100_000_000))).toBe('₦1M');
    expect(formatKoboCompact(BigInt('2500000000000'))).toBe('₦25B');
    expect(formatKoboCompact(k(-250_000_000))).toBe('−₦2.5M');
  });

  it('round-trips to decimal strings', () => {
    for (const s of ['0.00', '1.05', '-12.50', '1234567.89']) {
      expect(koboToDecimalString(toKobo(s) as bigint)).toBe(s);
    }
  });
});

describe('formatAmountIn', () => {
  it('uses the currency’s own sign, or its code when there is none', () => {
    expect(formatAmountIn('912.34', 'USD')).toBe('$912.34');
    expect(formatAmountIn('1000', 'eur')).toBe('€1,000.00');
    expect(formatAmountIn('25000.5', 'NGN')).toBe('₦25,000.50');
    expect(formatAmountIn('1000', 'KES')).toBe('1,000.00 KES');
    expect(formatAmountIn(null, 'USD')).toBe('—');
  });
});

describe('ratios and animation', () => {
  it('computes bar ratios without floating money', () => {
    expect(koboRatio(k(50), k(200))).toBe(0.25);
    expect(koboRatio(k(0), k(200))).toBe(0);
    expect(koboRatio(k(10), k(0))).toBe(0);
  });

  it('interpolates between two amounts in integer steps', () => {
    expect(interpolateKobo(k(0), k(10_000), 0)).toBe(k(0));
    expect(interpolateKobo(k(0), k(10_000), 0.5)).toBe(k(5000));
    expect(interpolateKobo(k(0), k(10_000), 1)).toBe(k(10_000));
    expect(interpolateKobo(k(100), k(0), 0.25)).toBe(k(75));
    expect(typeof interpolateKobo(k(1), k(3), 0.33)).toBe('bigint');
  });

  it('finds the largest amount', () => {
    expect(maxKobo([k(3), k(9), k(-1)])).toBe(k(9));
    expect(maxKobo([])).toBe(k(0));
  });
});
