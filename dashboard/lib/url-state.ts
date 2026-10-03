// ─── URL state ───────────────────────────────────────────────────────────────
// Filters live in the query string so every view is shareable and survives a
// reload. A schema describes each parameter: how to read it (rejecting
// anything malformed rather than passing it to the API) and how to write it
// (omitting defaults, so URLs stay short and canonical).

export interface ParamSpec<T> {
  parse(raw: string | null): T;
  /** Null omits the parameter from the URL. */
  serialize(value: T): string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(ymd: string): boolean {
  if (!DATE_RE.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

export const param = {
  /** One of a fixed set of values; anything else falls back to the default. */
  enum<V extends string, D extends V | undefined = undefined>(values: readonly V[], fallback?: D): ParamSpec<V | D> {
    return {
      parse: (raw) => (raw !== null && (values as readonly string[]).includes(raw) ? (raw as V) : (fallback as D)),
      serialize: (value) => (value === undefined || value === fallback ? null : value),
    };
  },

  /** Free text, trimmed and length-capped; empty means absent. */
  string(maxLength = 120): ParamSpec<string | undefined> {
    return {
      parse: (raw) => {
        const v = raw?.trim().slice(0, maxLength);
        return v ? v : undefined;
      },
      serialize: (value) => (value ? value.trim().slice(0, maxLength) || null : null),
    };
  },

  /** A non-negative integer within bounds; optionally restricted to an allowed set. */
  int(fallback: number, opts: { min?: number; max?: number; allowed?: readonly number[] } = {}): ParamSpec<number> {
    const { min = 0, max = Number.MAX_SAFE_INTEGER, allowed } = opts;
    return {
      parse: (raw) => {
        if (raw === null || !/^\d+$/.test(raw)) return fallback;
        const n = Number(raw);
        if (n < min || n > max) return fallback;
        if (allowed && !allowed.includes(n)) return fallback;
        return n;
      },
      serialize: (value) => (value === fallback ? null : String(value)),
    };
  },

  /** A calendar date, YYYY-MM-DD, that actually exists. */
  date(): ParamSpec<string | undefined> {
    return {
      parse: (raw) => (raw && isRealDate(raw) ? raw : undefined),
      serialize: (value) => (value && isRealDate(value) ? value : null),
    };
  },

  /** An opaque identifier (UUIDs, references): letters, digits, dashes and underscores. */
  id(): ParamSpec<string | undefined> {
    return {
      parse: (raw) => (raw && /^[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : undefined),
      serialize: (value) => (value && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null),
    };
  },
};

export type Schema = Record<string, ParamSpec<unknown>>;
export type ValuesOf<S extends Schema> = { [K in keyof S]: ReturnType<S[K]['parse']> };

interface ReadableParams {
  get(name: string): string | null;
}

export function parseParams<S extends Schema>(schema: S, params: ReadableParams): ValuesOf<S> {
  const out = {} as ValuesOf<S>;
  for (const key of Object.keys(schema) as (keyof S & string)[]) {
    out[key] = schema[key].parse(params.get(key)) as ValuesOf<S>[typeof key];
  }
  return out;
}

/** Canonical query string ("?a=1&b=2", or "" when everything is default), in schema order. */
export function toSearch<S extends Schema>(schema: S, values: Partial<ValuesOf<S>>): string {
  const sp = new URLSearchParams();
  for (const key of Object.keys(schema) as (keyof S & string)[]) {
    const value = values[key];
    if (value === undefined) continue;
    const s = schema[key].serialize(value);
    if (s !== null && s !== '') sp.set(key, s);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * Apply a patch to the current values. Changing any key listed in
 * `resetOnChange` (the filters) sends `resetKey` (the page offset) back to its
 * default, so a narrower filter never lands on an empty later page.
 */
export function applyPatch<S extends Schema>(
  schema: S,
  current: ValuesOf<S>,
  patch: Partial<ValuesOf<S>>,
  options: { resetKey?: keyof S & string; resetOnChange?: readonly (keyof S & string)[] } = {},
): ValuesOf<S> {
  const next = { ...current, ...patch };
  const { resetKey, resetOnChange } = options;
  if (resetKey && resetOnChange?.some((k) => k in patch && patch[k] !== current[k]) && !(resetKey in patch)) {
    next[resetKey] = schema[resetKey].parse(null) as ValuesOf<S>[typeof resetKey];
  }
  return next;
}

/** Number of active (non-default) parameters among `keys`. */
export function countActive<S extends Schema>(schema: S, values: ValuesOf<S>, keys: readonly (keyof S & string)[]): number {
  return keys.filter((k) => values[k] !== undefined && schema[k].serialize(values[k]) !== null).length;
}
