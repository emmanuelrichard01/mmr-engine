import { describe, expect, it } from 'vitest';
import { applyPatch, countActive, param, parseParams, toSearch } from '@/lib/url-state';

const STATUSES = ['open', 'resolved', 'all'] as const;
const schema = {
  status: param.enum(STATUSES, 'open'),
  severity: param.enum(['critical', 'high'] as const),
  q: param.string(20),
  from: param.date(),
  size: param.int(50, { allowed: [50, 100, 200] }),
  offset: param.int(0, { max: 100_000 }),
  id: param.id(),
};

const read = (search: string) => parseParams(schema, new URLSearchParams(search));

describe('parseParams', () => {
  it('fills defaults for an empty query string', () => {
    expect(read('')).toEqual({
      status: 'open',
      severity: undefined,
      q: undefined,
      from: undefined,
      size: 50,
      offset: 0,
      id: undefined,
    });
  });

  it('reads valid values', () => {
    const v = read('status=resolved&severity=high&q=DEMO-PSK&from=2026-10-01&size=200&offset=50&id=3f2a-11');
    expect(v).toMatchObject({ status: 'resolved', severity: 'high', q: 'DEMO-PSK', from: '2026-10-01', size: 200, offset: 50, id: '3f2a-11' });
  });

  it('rejects malformed values instead of passing them to the API', () => {
    const v = read('status=deleted&severity=CRITICAL&from=2026-02-30&size=75&offset=-5&id=../etc');
    expect(v).toMatchObject({ status: 'open', severity: undefined, from: undefined, size: 50, offset: 0, id: undefined });
  });

  it('trims and caps free text', () => {
    expect(read(`q=${encodeURIComponent('   ')}`).q).toBeUndefined();
    expect(read(`q=${'x'.repeat(50)}`).q).toHaveLength(20);
  });
});

describe('toSearch', () => {
  it('omits defaults and keeps schema order', () => {
    expect(toSearch(schema, read(''))).toBe('');
    expect(toSearch(schema, { ...read(''), offset: 50, status: 'all', q: 'abc' })).toBe('?status=all&q=abc&offset=50');
  });

  it('round-trips', () => {
    const search = '?status=resolved&severity=critical&from=2026-09-01&size=100&id=abc';
    expect(toSearch(schema, read(search))).toBe(search);
  });
});

describe('applyPatch', () => {
  const opts = { resetKey: 'offset' as const, resetOnChange: ['status', 'severity', 'q'] as const };

  it('resets the page when a filter changes', () => {
    const current = { ...read(''), offset: 150 };
    expect(applyPatch(schema, current, { severity: 'critical' }, opts).offset).toBe(0);
  });

  it('keeps the page when the filter value is unchanged or only the page moves', () => {
    const current = { ...read(''), offset: 150 };
    expect(applyPatch(schema, current, { status: 'open' }, opts).offset).toBe(150);
    expect(applyPatch(schema, current, { offset: 200 }, opts).offset).toBe(200);
    expect(applyPatch(schema, current, { id: 'x1' }, opts).offset).toBe(150);
  });

  it('counts active filters', () => {
    const v = { ...read(''), severity: 'high' as const, q: 'DEMO' };
    expect(countActive(schema, v, ['status', 'severity', 'q', 'from'])).toBe(2);
  });
});
