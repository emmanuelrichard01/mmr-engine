// ─── Money ───────────────────────────────────────────────────────────────────
// The API returns every money field as a decimal string (e.g. "50000.00").
// Amounts are parsed into integer kobo (BigInt) and never touch floating-point
// arithmetic. Formatting is done from the integer representation.

/** A decimal string as returned by the API, e.g. "50000.00" or "-12.5". */
export type DecimalString = string;

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d*))?$/;
const HUNDRED = BigInt(100);
const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * Parse a decimal string into integer kobo. Values with more than two
 * fractional digits are rounded half away from zero. Returns null when the
 * input is missing or not a plain decimal.
 */
export function toKobo(value: DecimalString | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const match = DECIMAL_RE.exec(String(value).trim());
  if (!match) return null;
  const [, sign, whole, frac = ''] = match;
  let kobo = BigInt(whole) * HUNDRED + BigInt((frac + '00').slice(0, 2));
  if (frac.length > 2 && frac.charCodeAt(2) >= 53 /* '5' */) kobo += ONE;
  return sign === '-' ? -kobo : kobo;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format integer kobo as "₦1,234,567.89". */
export function formatKobo(kobo: bigint): string {
  const negative = kobo < ZERO;
  const abs = negative ? -kobo : kobo;
  const naira = groupThousands((abs / HUNDRED).toString());
  const rem = (abs % HUNDRED).toString().padStart(2, '0');
  return `${negative ? '−' : ''}₦${naira}.${rem}`;
}

/** Format an API decimal string as "₦1,234,567.89" (or "—" when absent). */
export function formatNgn(value: DecimalString | null | undefined): string {
  const kobo = toKobo(value);
  return kobo === null ? '—' : formatKobo(kobo);
}

/** Sum decimal strings exactly. Unparseable values are ignored. */
export function sumKobo(values: (DecimalString | null | undefined)[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + (toKobo(v) ?? ZERO), ZERO);
}

/** Ratio a/b in [0, 1] for sizing bars. Display-only; not used for money. */
export function koboRatio(a: bigint, b: bigint): number {
  if (b <= ZERO || a <= ZERO) return 0;
  return Number((a * BigInt(10_000)) / b) / 10_000;
}

/** Parts of a formatted amount, so the currency sign can be typeset apart from the figure. */
export interface MoneyParts {
  sign: '' | '−';
  symbol: '₦';
  whole: string;
  fraction: string;
}

export function koboParts(kobo: bigint): MoneyParts {
  const negative = kobo < ZERO;
  const abs = negative ? -kobo : kobo;
  return {
    sign: negative ? '−' : '',
    symbol: '₦',
    whole: groupThousands((abs / HUNDRED).toString()),
    fraction: (abs % HUNDRED).toString().padStart(2, '0'),
  };
}

const COMPACT_STEPS: [bigint, string][] = [
  [BigInt(1_000_000_000_000), 'T'],
  [BigInt(1_000_000_000), 'B'],
  [BigInt(1_000_000), 'M'],
  [BigInt(1_000), 'K'],
];

/**
 * Compact amount for axes and dense labels, e.g. "₦1.2M". Integer arithmetic
 * only; the single decimal is truncated, never rounded up past the true value.
 */
export function formatKoboCompact(kobo: bigint): string {
  const negative = kobo < ZERO;
  const naira = (negative ? -kobo : kobo) / HUNDRED;
  const sign = negative ? '−' : '';
  for (const [step, suffix] of COMPACT_STEPS) {
    if (naira >= step) {
      const tenths = (naira * BigInt(10)) / step;
      const whole = tenths / BigInt(10);
      const decimal = tenths % BigInt(10);
      return `${sign}₦${whole.toString()}${decimal === ZERO || whole >= BigInt(100) ? '' : `.${decimal.toString()}`}${suffix}`;
    }
  }
  return `${sign}₦${naira.toString()}`;
}

/**
 * The amount at fraction `t` (0..1) of the way from `from` to `to`, for
 * animated counters. Display-only, and still integer arithmetic: `t` is
 * quantised to 1/10,000 before it touches the amount.
 */
export function interpolateKobo(from: bigint, to: bigint, t: number): bigint {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const steps = BigInt(Math.round(t * 10_000));
  return from + ((to - from) * steps) / BigInt(10_000);
}

/** Largest of a list of amounts (zero for an empty list). */
export function maxKobo(values: bigint[]): bigint {
  return values.reduce((m, v) => (v > m ? v : m), ZERO);
}

/** Serialise kobo back to a plain decimal string ("1234.50"). */
export function koboToDecimalString(kobo: bigint): DecimalString {
  const negative = kobo < ZERO;
  const abs = negative ? -kobo : kobo;
  return `${negative ? '-' : ''}${(abs / HUNDRED).toString()}.${(abs % HUNDRED).toString().padStart(2, '0')}`;
}
