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

/** Serialise kobo back to a plain decimal string ("1234.50"). */
export function koboToDecimalString(kobo: bigint): DecimalString {
  const negative = kobo < ZERO;
  const abs = negative ? -kobo : kobo;
  return `${negative ? '-' : ''}${(abs / HUNDRED).toString()}.${(abs % HUNDRED).toString().padStart(2, '0')}`;
}
