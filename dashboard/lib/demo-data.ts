// ─── Demo fixtures ───────────────────────────────────────────────────────────
// Used ONLY when the dashboard is built with NEXT_PUBLIC_DEMO_MODE=true, in
// which case every page carries a persistent "Demo data" banner.
//
// One seeded, deterministic dataset is generated in memory: synthetic
// transactions (references start with "DEMO-"), the pairs the matching tiers
// would form between them, the discrepancies those raise, and every aggregate
// (summary, trend, PSP health, exposure, daily returns) computed from that same
// set, so each view agrees with every other. Timestamps are relative to when
// the page loaded. Resolving a discrepancy changes this in-memory copy only;
// a reload starts over. Nothing here describes real traffic.

import {
  AGING_BUCKETS,
  ApiError,
  MAX_BULK_RESOLVE,
  MIN_SEARCH_LENGTH,
  type AgingBucket,
  type AgingBucketRow,
  type BulkResolveResponse,
  type DailyReportsResponse,
  type Discrepancy,
  type DiscrepancyEvent,
  type DiscrepancyEventsResponse,
  type DiscrepancyFilters,
  type DiscrepancyListResponse,
  type ExposureAgingResponse,
  type ExposureResponse,
  type LinkedDiscrepancy,
  type Lineage,
  type PairDetailResponse,
  type PairFilters,
  type PairListItem,
  type PairListResponse,
  type PipelineRun,
  type PipelineRunsResponse,
  type PspHealthResponse,
  type ReadinessBody,
  type ReconciliationSummary,
  type ResolveOutcome,
  type ResolveResponse,
  type SearchResponse,
  type SearchResult,
  type Severity,
  type TransactionDetail,
  type TransactionDetailResponse,
  type TransactionFilters,
  type TransactionListResponse,
  type TransactionSummary,
  type TrendResponse,
} from './api';
import { formatNgn, koboToDecimalString, toKobo } from './money';
import { formatScore, humanize, lagosDate, pspDisplayName, strategyLabel } from './utils';

// ── Clock and randomness ─────────────────────────────────────────────────────

const NOW = Date.now();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 30;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261003);
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function uuid(): string {
  let hex = '';
  for (let i = 0; i < 32; i++) hex += Math.floor(rand() * 16).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[Math.floor(rand() * 4)]}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function refCode(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += REF_CHARS[Math.floor(rand() * REF_CHARS.length)];
  return s;
}

const iso = (ms: number) => new Date(ms).toISOString();
const money = (kobo: bigint) => koboToDecimalString(kobo);
const koboOf = (value: string) => toKobo(value) ?? BigInt(0);

// ── Vocabulary ───────────────────────────────────────────────────────────────

const BANKS = ['GTBank', 'Access Bank', 'Zenith Bank', 'First Bank', 'UBA', 'Kuda MFB', 'OPay', 'Moniepoint MFB', 'Wema Bank', 'Stanbic IBTC'];
const FIRST = ['Adaeze', 'Babatunde', 'Chinedu', 'Damilola', 'Emeka', 'Folake', 'Halima', 'Ifeoma', 'Kelechi', 'Musa', 'Ngozi', 'Olumide', 'Sadiq', 'Temitope', 'Yetunde', 'Zainab'];
const LAST = ['Okafor', 'Adeyemi', 'Balogun', 'Eze', 'Ibrahim', 'Nwosu', 'Ogunleye', 'Bello', 'Okonkwo', 'Abubakar', 'Adebayo', 'Uche'];
const ANALYSTS = ['analyst.chiamaka', 'analyst.ibrahim', 'analyst.funmi'];

function maskName(): string {
  const f = pick(FIRST);
  const l = pick(LAST);
  return `${f[0]}${'*'.repeat(f.length - 1)} ${l[0]}${'*'.repeat(l.length - 1)}`;
}

/** Log-uniform naira amount between ₦1,500 and ₦2.5m, rounded to ₦50, in kobo. */
function amountKobo(): bigint {
  const naira = Math.exp(between(Math.log(1500), Math.log(2_500_000)));
  return BigInt(Math.max(1, Math.round(naira / 50))) * BigInt(5000);
}

// ── Model ────────────────────────────────────────────────────────────────────

interface Txn extends TransactionDetail {
  lineage: Lineage;
}

interface Pair {
  id: string;
  a: Txn;
  b: Txn;
  match_strategy: 'exact_primary' | 'probabilistic_secondary';
  confidence: number;
  status: PairListItem['status'];
  delta: bigint;
  within_fx: boolean;
  evidence: Record<string, unknown>;
  created_at: number;
}

interface Disc {
  id: string;
  txn: Txn;
  pair: Pair | null;
  type: string;
  severity: Severity | null;
  exposure: bigint;
  evidence: Record<string, unknown>;
  detected: number;
  status: Discrepancy['status'];
  resolved_at: number | null;
  resolved_by: string | null;
  note: string | null;
  events: DiscrepancyEvent[];
}

const txns: Txn[] = [];
const txnById = new Map<string, Txn>();
const allPairs: Pair[] = [];
const pairByTxn = new Map<string, Pair>();
const discs: Disc[] = [];

const CONSUMER_RUN_ID = uuid();
const offsets: Record<string, number> = { paystack: 184_220, flutterwave: 97_310 };

function makeTxn(input: {
  psp: string;
  type: TransactionSummary['transaction_type'];
  kobo: bigint;
  at: number;
  settlement: TransactionSummary['settlement_status'];
  settledAfterMs?: number | null;
  expectedAfterMs?: number | null;
  ref?: string;
  usd?: { cents: bigint; rateKobo: bigint };
}): Txn {
  const id = uuid();
  const psp = input.psp;
  const prefix = psp === 'paystack' ? 'DEMO-PSK' : 'DEMO-FLW';
  const ref = input.ref ?? `${prefix}-${refCode(8)}`;
  const eventType =
    psp === 'paystack'
      ? input.type === 'credit'
        ? 'charge.success'
        : input.type === 'reversal'
          ? 'transfer.reversed'
          : input.settlement === 'failed'
            ? 'transfer.failed'
            : 'transfer.success'
      : input.type === 'credit'
        ? 'charge.completed'
        : 'transfer.completed';
  const receivedAt = input.at + intBetween(400, 2600);
  const createdAt = receivedAt + intBetween(300, 4000);
  const offset = (offsets[psp] += intBetween(1, 4));
  const dateStr = lagosDate(receivedAt);
  const hour = new Date(receivedAt).toISOString().slice(11, 13);
  const kobo = input.usd ? (input.usd.cents * input.usd.rateKobo) / BigInt(100) : input.kobo;
  const t: Txn = {
    id,
    psp_name: psp,
    psp_transaction_ref: ref,
    transaction_type: input.type,
    amount_ngn: money(kobo),
    amount_raw: input.usd ? money(input.usd.cents) : money(kobo),
    currency_raw: input.usd ? 'USD' : 'NGN',
    settlement_status: input.settlement,
    initiated_at: iso(input.at),
    settled_at: input.settledAfterMs == null ? null : iso(input.at + input.settledAfterMs),
    expected_settlement_at: input.expectedAfterMs == null ? null : iso(input.at + input.expectedAfterMs),
    beneficiary_name_masked: input.type === 'credit' ? maskName() : rand() < 0.85 ? maskName() : null,
    beneficiary_bank_name: rand() < 0.9 ? pick(BANKS) : null,
    match_status: 'unmatched',
    pair_id: null,
    open_discrepancies: 0,
    psp_event_type: eventType,
    beneficiary_account_masked: rand() < 0.85 ? `******${intBetween(1000, 9999)}` : null,
    narration: rand() < 0.6 ? pick(['Wallet top-up', 'Merchant payout', 'Invoice settlement', 'Customer refund', 'POS settlement', 'Subscription']) : null,
    fx_rate_applied: input.usd ? money(input.usd.rateKobo) : null,
    idempotency_key: `${psp}:${eventType}:${ref}`,
    created_at: iso(createdAt),
    lineage: {
      kafka_topic: `raw.${psp}.events`,
      kafka_partition: intBetween(0, 2),
      kafka_offset: offset,
      bronze_received_at: iso(receivedAt),
      bronze_file_path: `${psp}/event_date=${dateStr}/hour=${hour}/${CONSUMER_RUN_ID}-part-${String(intBetween(1, 40)).padStart(4, '0')}.parquet`,
      run_id: CONSUMER_RUN_ID,
    },
  };
  txns.push(t);
  txnById.set(id, t);
  return t;
}

function makePair(a: Txn, b: Txn, p: Omit<Pair, 'id' | 'a' | 'b'>): Pair {
  const pair: Pair = { id: uuid(), a, b, ...p };
  a.match_status = 'matched';
  b.match_status = 'matched';
  a.pair_id = pair.id;
  b.pair_id = pair.id;
  allPairs.push(pair);
  pairByTxn.set(a.id, pair);
  pairByTxn.set(b.id, pair);
  return pair;
}

const RESOLUTION_NOTES: Record<string, string[]> = {
  missing_settlement: ['Settlement located in the next PSP payout batch; reference matched.', 'PSP confirmed the payout was delayed by the bank; settled the next morning.'],
  amount_mismatch: ['Difference is the PSP processing fee, deducted at source as per contract.', 'Partial refund issued by the merchant explains the difference.'],
  fx_variance: ['Variance within treasury tolerance after checking the rate snapshot.'],
  duplicate_credit: ['Duplicate reversed by the PSP; reversal reference recorded.'],
  late_settlement: ['Bank holiday delayed settlement; no funds missing.'],
  unmatched_credit: ['Counterpart found in a manual ledger entry; booked by finance.'],
};

function lifecycle(detected: number): Pick<Disc, 'status' | 'resolved_at' | 'resolved_by'> & { outcomeNote: boolean } {
  const ageDays = (NOW - detected) / DAY;
  const r = rand();
  const close = (status: 'resolved' | 'false_positive') => ({
    status,
    resolved_at: Math.min(NOW - 10 * MINUTE, detected + between(2, 40) * HOUR),
    resolved_by: pick(ANALYSTS),
    outcomeNote: true,
  });
  const keep = (status: Discrepancy['status']) => ({ status, resolved_at: null, resolved_by: null, outcomeNote: false });
  if (ageDays > 6) return r < 0.72 ? close('resolved') : r < 0.86 ? close('false_positive') : r < 0.93 ? keep('escalated') : keep('open');
  if (ageDays > 2) return r < 0.4 ? close('resolved') : r < 0.5 ? close('false_positive') : r < 0.6 ? keep('under_review') : r < 0.7 ? keep('escalated') : keep('open');
  return r < 0.9 ? keep('open') : keep('under_review');
}

function raise(txn: Txn, pair: Pair | null, type: string, severity: Severity | null, exposure: bigint, evidence: Record<string, unknown>, detected: number) {
  if (detected > NOW) return;
  const life = lifecycle(detected);
  const d: Disc = {
    id: uuid(),
    txn,
    pair,
    type,
    severity: rand() < 0.04 ? null : severity,
    exposure,
    evidence,
    detected,
    status: life.status,
    resolved_at: life.resolved_at,
    resolved_by: life.resolved_by,
    note: life.outcomeNote ? pick(RESOLUTION_NOTES[type] ?? RESOLUTION_NOTES.unmatched_credit) : null,
    events: [{ action: 'raised', from_status: null, to_status: 'open', actor: 'engine', note: null, occurred_at: iso(detected) }],
  };
  if (d.status === 'escalated') {
    d.events.push({ action: 'escalated', from_status: 'open', to_status: 'escalated', actor: pick(ANALYSTS), note: 'Needs the PSP account manager.', occurred_at: iso(Math.min(NOW - MINUTE, detected + 3 * HOUR)) });
  }
  if (d.resolved_at !== null) {
    const from = d.events.at(-1)?.to_status ?? 'open';
    d.events.push({
      action: d.status === 'false_positive' ? 'marked_false_positive' : 'resolved',
      from_status: from,
      to_status: d.status,
      actor: d.resolved_by,
      note: d.note,
      occurred_at: iso(d.resolved_at),
    });
  }
  discs.push(d);
}

// ── Generate ─────────────────────────────────────────────────────────────────

function generate() {
  const MOVEMENTS = 1150;
  for (let i = 0; i < MOVEMENTS; i++) {
    // Slightly busier recently; never in the future.
    const at = NOW - Math.pow(rand(), 1.1) * HISTORY_DAYS * DAY;
    const kobo = amountKobo();
    const pspA = rand() < 0.58 ? 'paystack' : 'flutterwave';
    const pspB = pspA === 'paystack' ? 'flutterwave' : 'paystack';
    const r = rand();

    if (r < 0.8) {
      // Tier 1: exact amount, complementary type, other PSP, close in time.
      const gap = intBetween(4, 1500) * SECOND;
      const usd = pspA === 'flutterwave' && rand() < 0.05 ? { cents: BigInt(intBetween(500, 150_000)), rateKobo: BigInt(intBetween(152_800, 153_900)) } : undefined;
      const a = makeTxn({ psp: pspA, type: 'credit', kobo, at, settlement: 'settled', settledAfterMs: intBetween(2, 30) * SECOND, usd });
      const late = rand() < 0.03;
      const expected = 6 * HOUR;
      const settledAfter = late ? expected + between(2, 20) * HOUR : intBetween(5, 90) * MINUTE;
      const b = makeTxn({ psp: pspB, type: 'debit', kobo: koboOf(a.amount_ngn), at: at + gap, settlement: 'settled', settledAfterMs: settledAfter, expectedAfterMs: expected });
      const pair = makePair(a, b, {
        match_strategy: 'exact_primary',
        confidence: 1,
        status: 'matched',
        delta: BigInt(0),
        within_fx: true,
        evidence: { time_delta_seconds: gap / SECOND, exact_candidates: 1 },
        created_at: at + gap + intBetween(1, 5) * MINUTE,
      });
      if (late) {
        const lateHours = Math.round(((settledAfter - expected) / HOUR) * 100) / 100;
        raise(b, pair, 'late_settlement', 'medium', BigInt(0), { expected_at: b.expected_settlement_at, settled_at: b.settled_at, late_hours: lateHours, amount_ngn: b.amount_ngn }, at + gap + settledAfter + intBetween(1, 5) * MINUTE);
      }
    } else if (r < 0.9) {
      // Tier 2: amounts within tolerance, wider time window, scored.
      const deltaBp = rand() < 0.45 ? 0 : intBetween(5, 160); // basis points
      const kobB = kobo - (kobo * BigInt(deltaBp)) / BigInt(10_000);
      const gapSeconds = intBetween(25, 8 * 60) * 60;
      const amount_score = Math.max(0, 1 - deltaBp / 200);
      const time_score = Math.max(0, 1 - gapSeconds / (24 * 3600));
      const name_score = Math.round(between(0.62, 1) * 100) / 100;
      const bank_score = rand() < 0.75 ? 1 : 0.5;
      let confidence = 0.4 * amount_score + 0.25 * time_score + 0.25 * name_score + 0.1 * bank_score;
      if (confidence < 0.75) confidence = 0.75 + rand() * 0.05;
      const a = makeTxn({ psp: pspA, type: 'credit', kobo, at, settlement: 'settled', settledAfterMs: intBetween(2, 30) * SECOND });
      const b = makeTxn({ psp: pspB, type: 'debit', kobo: kobB, at: at + gapSeconds * SECOND, settlement: 'settled', settledAfterMs: intBetween(5, 120) * MINUTE });
      const delta = kobo - kobB;
      const isMismatch = deltaBp > 50;
      const pair = makePair(a, b, {
        match_strategy: 'probabilistic_secondary',
        confidence: Math.round(confidence * 10_000) / 10_000,
        status: isMismatch ? 'discrepancy' : 'matched',
        delta,
        within_fx: !isMismatch,
        evidence: {
          amount_score: Math.round(amount_score * 10_000) / 10_000,
          time_score: Math.round(time_score * 10_000) / 10_000,
          name_score,
          bank_score,
          time_delta_seconds: gapSeconds,
        },
        created_at: at + gapSeconds * SECOND + intBetween(1, 5) * MINUTE,
      });
      if (isMismatch) {
        const pct = deltaBp / 100;
        raise(
          a,
          pair,
          'amount_mismatch',
          pct > 1 ? 'high' : 'medium',
          delta,
          { amount_a_ngn: a.amount_ngn, amount_b_ngn: b.amount_ngn, delta_ngn: money(delta), delta_pct: (deltaBp / 10_000).toFixed(4), fx_variance: null, classification: 'amount_mismatch' },
          pair.created_at + intBetween(10, 120) * SECOND,
        );
      }
    } else if (r < 0.94) {
      // A credit that never settled and has no counterpart.
      const expectedAfter = 24 * HOUR;
      const t = makeTxn({ psp: pspA, type: 'credit', kobo, at, settlement: 'pending', expectedAfterMs: expectedAfter });
      const due = at + expectedAfter;
      if (due < NOW) {
        const overdue = Math.round(((NOW - due) / HOUR) * 100) / 100;
        raise(t, null, 'missing_settlement', kobo > BigInt(50_000_000) ? 'critical' : 'high', kobo, { expected_settlement_at: t.expected_settlement_at, overdue_hours: overdue, amount_ngn: t.amount_ngn }, due + intBetween(1, 5) * MINUTE);
      }
    } else if (r < 0.955) {
      makeTxn({ psp: 'paystack', type: 'debit', kobo, at, settlement: 'failed' });
    } else if (r < 0.965) {
      makeTxn({ psp: 'paystack', type: 'reversal', kobo, at, settlement: 'reversed', settledAfterMs: intBetween(1, 20) * MINUTE });
    } else if (r < 0.975) {
      // Same PSP reference delivered twice as two different events.
      const ref = `DEMO-PSK-${refCode(8)}`;
      makeTxn({ psp: 'paystack', type: 'credit', kobo, at, settlement: 'settled', settledAfterMs: 5 * SECOND, ref });
      const dup = makeTxn({ psp: 'paystack', type: 'credit', kobo, at: at + intBetween(20, 90) * SECOND, settlement: 'settled', settledAfterMs: 5 * SECOND, ref });
      raise(dup, null, 'duplicate_credit', 'critical', kobo, { transaction_ref: ref, occurrence_count: 2, amount_per_occurrence_ngn: dup.amount_ngn, total_duplicate_exposure_ngn: dup.amount_ngn }, at + 3 * MINUTE);
    } else {
      // Settled but unmatched so far.
      const t = makeTxn({ psp: pspA, type: 'credit', kobo, at, settlement: 'settled', settledAfterMs: intBetween(2, 30) * SECOND });
      if (NOW - at > 2 * DAY && rand() < 0.5) {
        raise(t, null, 'unmatched_credit', 'low', kobo, { reason: 'No counterpart within the secondary matching window', window_hours: 48, amount_ngn: t.amount_ngn }, at + 48 * HOUR);
      }
    }
  }

  // A few FX variances on cross-border legs.
  for (const p of allPairs.filter((x) => x.a.currency_raw === 'USD').slice(0, 6)) {
    const variance = BigInt(intBetween(150, 4200));
    raise(p.a, p, 'fx_variance', 'low', variance, {
      amount_a_ngn: p.a.amount_ngn,
      amount_b_ngn: money(koboOf(p.a.amount_ngn) - variance),
      delta_ngn: money(variance),
      delta_pct: '0.0031',
      fx_variance: '0.002800',
      classification: 'fx_variance',
    }, p.created_at + 2 * MINUTE);
  }

  txns.sort((x, y) => y.initiated_at.localeCompare(x.initiated_at) || x.id.localeCompare(y.id));
  allPairs.sort((x, y) => y.created_at - x.created_at);
}

generate();

// ── Helpers ──────────────────────────────────────────────────────────────────

const latency = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const SEVERITY_RANK: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
const isOpen = (d: Disc) => d.status !== 'resolved' && d.status !== 'false_positive';

function openCountFor(txnId: string): number {
  return discs.filter((d) => d.txn.id === txnId && isOpen(d)).length;
}

function summaryOf(t: Txn): TransactionSummary {
  return {
    id: t.id,
    psp_name: t.psp_name,
    psp_transaction_ref: t.psp_transaction_ref,
    transaction_type: t.transaction_type,
    amount_ngn: t.amount_ngn,
    amount_raw: t.amount_raw,
    currency_raw: t.currency_raw,
    settlement_status: t.settlement_status,
    initiated_at: t.initiated_at,
    settled_at: t.settled_at,
    expected_settlement_at: t.expected_settlement_at,
    beneficiary_name_masked: t.beneficiary_name_masked,
    beneficiary_bank_name: t.beneficiary_bank_name,
    match_status: t.match_status,
    pair_id: t.pair_id,
    open_discrepancies: openCountFor(t.id),
  };
}

function toDiscrepancy(d: Disc): Discrepancy {
  return {
    id: d.id,
    transaction_id: d.txn.id,
    discrepancy_type: d.type,
    severity: d.severity,
    estimated_exposure_ngn: money(d.exposure),
    amount_ngn: d.txn.amount_ngn,
    evidence: d.evidence,
    status: d.status,
    detected_at: iso(d.detected),
    resolved_at: d.resolved_at === null ? null : iso(d.resolved_at),
    resolved_by: d.resolved_by,
    resolution_note: d.note,
    psp_name: d.txn.psp_name,
    psp_transaction_ref: d.txn.psp_transaction_ref,
  };
}

function linked(d: Disc): LinkedDiscrepancy {
  return {
    id: d.id,
    discrepancy_type: d.type,
    severity: d.severity,
    status: d.status,
    estimated_exposure_ngn: money(d.exposure),
    detected_at: iso(d.detected),
  };
}

function sumKoboOf(items: Disc[]): bigint {
  return items.reduce((acc, d) => acc + d.exposure, BigInt(0));
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export async function discrepancies(filters: DiscrepancyFilters): Promise<DiscrepancyListResponse> {
  await latency();
  const rows = discs
    .filter((d) => filters.status === 'all' || d.status === filters.status)
    .filter((d) => !filters.severity || d.severity === filters.severity)
    .filter((d) => !filters.psp_name || d.txn.psp_name === filters.psp_name)
    .sort((a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 5) - (SEVERITY_RANK[b.severity ?? ''] ?? 5) || b.detected - a.detected || a.id.localeCompare(b.id));
  const page = rows.slice(filters.offset, filters.offset + filters.limit).map(toDiscrepancy);
  return { discrepancies: page, limit: filters.limit, offset: filters.offset, count: page.length };
}

export async function discrepancyEvents(id: string): Promise<DiscrepancyEventsResponse> {
  await latency(120);
  const d = discs.find((x) => x.id === id);
  return { discrepancy_id: id, events: d ? d.events.map((e) => ({ ...e })) : [] };
}

/** Notes containing this marker fail, so the optimistic rollback can be exercised in demo mode. */
export const SIMULATE_FAILURE_MARKER = '[simulate-failure]';
const DEMO_ACTOR = 'demo-analyst';

function closeOne(d: Disc, note: string, outcome: ResolveOutcome) {
  const from = d.status;
  d.status = outcome;
  d.resolved_at = Date.now();
  d.resolved_by = DEMO_ACTOR;
  d.note = note;
  d.events.push({
    action: outcome === 'false_positive' ? 'marked_false_positive' : 'resolved',
    from_status: from,
    to_status: outcome,
    actor: DEMO_ACTOR,
    note,
    occurred_at: iso(d.resolved_at),
  });
  if (d.pair && outcome === 'resolved') d.pair.status = 'resolved';
  if (d.pair && outcome === 'false_positive') d.pair.status = 'false_positive';
}

export async function resolve(id: string, note: string, outcome: ResolveOutcome): Promise<ResolveResponse> {
  await latency(800);
  if (note.includes(SIMULATE_FAILURE_MARKER)) throw new ApiError(503, 'Simulated failure (demo mode)');
  if (note.trim().length < 10) throw new ApiError(422, 'String should have at least 10 characters');
  const d = discs.find((x) => x.id === id);
  if (!d) throw new ApiError(404, 'Discrepancy not found');
  if (!isOpen(d)) throw new ApiError(409, `Already ${d.status}`);
  closeOne(d, note.trim(), outcome);
  return { discrepancy_id: id, status: outcome, resolved_by: DEMO_ACTOR };
}

export async function bulkResolve(ids: string[], note: string, outcome: ResolveOutcome): Promise<BulkResolveResponse> {
  await latency(900);
  if (note.includes(SIMULATE_FAILURE_MARKER)) throw new ApiError(503, 'Simulated failure (demo mode)');
  if (ids.length < 1 || ids.length > MAX_BULK_RESOLVE) throw new ApiError(422, `Between 1 and ${MAX_BULK_RESOLVE} ids`);
  const out: BulkResolveResponse = { resolved: [], skipped: [] };
  for (const id of ids) {
    const d = discs.find((x) => x.id === id);
    if (!d) out.skipped.push({ id, reason: 'not_found' });
    else if (!isOpen(d)) out.skipped.push({ id, reason: 'already_closed' });
    else {
      closeOne(d, note.trim(), outcome);
      out.resolved.push(id);
    }
  }
  return out;
}

export async function exposure(): Promise<ExposureResponse> {
  await latency();
  const groups = new Map<string, Disc[]>();
  const open = discs.filter(isOpen);
  for (const d of open) {
    const key = `${d.txn.psp_name}|${d.type}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const by = [...groups.entries()]
    .map(([key, rows]) => {
      const [psp_name, discrepancy_type] = key.split('|');
      return { psp_name, discrepancy_type, open_count: rows.length, kobo: sumKoboOf(rows) };
    })
    .sort((a, b) => (b.kobo > a.kobo ? 1 : b.kobo < a.kobo ? -1 : 0))
    .map(({ kobo, ...rest }) => ({ ...rest, total_exposure_ngn: money(kobo) }));
  return { total_open_exposure_ngn: money(sumKoboOf(open)), by_psp_and_type: by, generated_at: iso(Date.now()) };
}

function bucketOf(detected: number): AgingBucket {
  const days = (Date.now() - detected) / DAY;
  if (days < 1) return '0-1d';
  if (days < 3) return '1-3d';
  if (days < 7) return '3-7d';
  return '7d+';
}

function bucketsFor(rows: Disc[]): AgingBucketRow[] {
  return AGING_BUCKETS.map((bucket) => {
    const inBucket = rows.filter((d) => bucketOf(d.detected) === bucket);
    return { bucket, count: inBucket.length, exposure_ngn: money(sumKoboOf(inBucket)) };
  });
}

export async function exposureAging(): Promise<ExposureAgingResponse> {
  await latency();
  const open = discs.filter(isOpen);
  return {
    buckets: bucketsFor(open),
    by_psp: ['paystack', 'flutterwave'].map((psp_name) => ({ psp_name, buckets: bucketsFor(open.filter((d) => d.txn.psp_name === psp_name)) })),
    generated_at: iso(Date.now()),
  };
}

function dayRows(date: string) {
  return txns.filter((t) => lagosDate(t.initiated_at) === date);
}

function lagosDays(count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(lagosDate(NOW - i * DAY));
  return [...new Set(out)];
}

export async function trend(days: number): Promise<TrendResponse> {
  await latency();
  return {
    days: lagosDays(days).map((date) => {
      const rows = dayRows(date);
      const matched = rows.filter((t) => t.match_status === 'matched').length;
      const volume = rows.reduce((acc, t) => acc + koboOf(t.amount_ngn), BigInt(0));
      return {
        date,
        total: rows.length,
        matched,
        match_rate_pct: rows.length ? Math.round((matched / rows.length) * 10_000) / 100 : null,
        volume_ngn: money(volume),
        discrepancies_raised: discs.filter((d) => lagosDate(d.detected) === date).length,
      };
    }),
  };
}

export async function summary(): Promise<ReconciliationSummary> {
  await latency();
  const date = lagosDate(NOW);
  const rows = dayRows(date);
  const matched = rows.filter((t) => t.match_status === 'matched').length;
  const byType = new Map<string, Disc[]>();
  for (const d of discs.filter((x) => lagosDate(x.detected) === date)) byType.set(d.type, [...(byType.get(d.type) ?? []), d]);
  return {
    report_date: date,
    total_transactions: rows.length,
    matched,
    unmatched: rows.length - matched,
    match_rate_pct: rows.length ? Math.round((matched / rows.length) * 10_000) / 100 : null,
    discrepancies: [...byType.entries()].map(([discrepancy_type, list]) => ({ discrepancy_type, count: list.length, total_exposure: money(sumKoboOf(list)) })),
    generated_at: iso(NOW - 4 * MINUTE),
  };
}

export async function pspHealth(): Promise<PspHealthResponse> {
  await latency();
  return {
    psps: ['paystack', 'flutterwave'].map((psp) => {
      const mine = txns.filter((t) => t.psp_name === psp);
      const last24 = mine.filter((t) => NOW - Date.parse(t.initiated_at) <= DAY);
      const week = mine.filter((t) => NOW - Date.parse(t.initiated_at) <= 7 * DAY);
      const open = discs.filter((d) => isOpen(d) && d.txn.psp_name === psp);
      return {
        psp_name: psp,
        events_24h: last24.length,
        last_event_at: mine[0]?.initiated_at ?? null,
        match_rate_pct_7d: week.length ? Math.round((week.filter((t) => t.match_status === 'matched').length / week.length) * 10_000) / 100 : null,
        open_discrepancies: open.length,
        open_exposure_ngn: money(sumKoboOf(open)),
      };
    }),
  };
}

export async function dailyReports({ limit, offset }: { limit: number; offset: number }): Promise<DailyReportsResponse> {
  await latency();
  const completed = lagosDays(HISTORY_DAYS).slice(0, -1).reverse();
  const reports = completed.map((date, i) => {
    const rows = dayRows(date);
    const matched = rows.filter((t) => t.match_status === 'matched').length;
    const raised = discs.filter((d) => lagosDate(d.detected) === date);
    const stillOpen = raised.filter(isOpen);
    return {
      report_date: date,
      total_transactions: rows.length,
      total_volume_ngn: money(rows.reduce((acc, t) => acc + koboOf(t.amount_ngn), BigInt(0))),
      match_rate_pct: rows.length ? Math.round((matched / rows.length) * 10_000) / 100 : null,
      cross_border_count: rows.filter((t) => t.currency_raw !== 'NGN').length,
      suspicious_flags: raised.filter((d) => d.type === 'duplicate_credit').length,
      open_discrepancies: stillOpen.length,
      total_exposure_ngn: money(sumKoboOf(stillOpen)),
      status: i < 2 ? 'draft' : 'approved',
      generated_at: iso(Date.parse(`${date}T01:00:00Z`) + DAY),
    };
  });
  const page = reports.slice(offset, offset + limit);
  return { reports: page, count: page.length };
}

export async function transactions(f: TransactionFilters): Promise<TransactionListResponse> {
  await latency(200);
  const q = f.q?.trim().toUpperCase();
  const rows = txns.filter((t) => {
    if (q && !(t.psp_transaction_ref.toUpperCase().startsWith(q) || t.id.toUpperCase() === q)) return false;
    if (f.psp_name && t.psp_name !== f.psp_name) return false;
    if (f.transaction_type && t.transaction_type !== f.transaction_type) return false;
    if (f.match_status && t.match_status !== f.match_status) return false;
    if (f.settlement_status && t.settlement_status !== f.settlement_status) return false;
    const day = lagosDate(t.initiated_at);
    if (f.date_from && day < f.date_from) return false;
    if (f.date_to && day > f.date_to) return false;
    return true;
  });
  return { transactions: rows.slice(f.offset, f.offset + f.limit).map(summaryOf), total: rows.length, limit: f.limit, offset: f.offset };
}

export async function transaction(id: string): Promise<TransactionDetailResponse> {
  await latency(180);
  const t = txnById.get(id);
  if (!t) throw new ApiError(404, 'Transaction not found');
  const p = pairByTxn.get(id) ?? null;
  const other = p ? (p.a.id === id ? p.b : p.a) : null;
  const { lineage, ...detail } = t;
  return {
    transaction: { ...detail, open_discrepancies: openCountFor(id) },
    pair:
      p && other
        ? {
            id: p.id,
            match_strategy: p.match_strategy,
            confidence_score: p.confidence.toFixed(4),
            status: p.status,
            amount_delta_ngn: money(p.delta),
            match_evidence: p.evidence,
            counterpart: {
              id: other.id,
              psp_name: other.psp_name,
              psp_transaction_ref: other.psp_transaction_ref,
              transaction_type: other.transaction_type,
              amount_ngn: other.amount_ngn,
              initiated_at: other.initiated_at,
            },
          }
        : null,
    discrepancies: discs.filter((d) => d.txn.id === id).map(linked),
    lineage,
  };
}

function pairItem(p: Pair): PairListItem {
  return {
    id: p.id,
    transaction_a_id: p.a.id,
    transaction_b_id: p.b.id,
    match_strategy: p.match_strategy,
    confidence_score: p.confidence.toFixed(4),
    status: p.status,
    amount_a_ngn: p.a.amount_ngn,
    amount_b_ngn: p.b.amount_ngn,
    amount_delta_ngn: money(p.delta),
    is_within_fx_threshold: p.within_fx,
    psp_a: p.a.psp_name,
    psp_b: p.b.psp_name,
    created_at: iso(p.created_at),
  };
}

export async function pairs(f: PairFilters): Promise<PairListResponse> {
  await latency();
  const rows = allPairs.filter((p) => (!f.status || p.status === f.status) && (!f.psp_name || p.a.psp_name === f.psp_name || p.b.psp_name === f.psp_name));
  const page = rows.slice(f.offset, f.offset + f.limit).map(pairItem);
  return { pairs: page, limit: f.limit, offset: f.offset, count: page.length };
}

export async function pair(id: string): Promise<PairDetailResponse> {
  await latency(180);
  const p = allPairs.find((x) => x.id === id);
  if (!p) throw new ApiError(404, 'Pair not found');
  return {
    pair: {
      id: p.id,
      match_strategy: p.match_strategy,
      confidence_score: p.confidence.toFixed(4),
      status: p.status,
      amount_a_ngn: p.a.amount_ngn,
      amount_b_ngn: p.b.amount_ngn,
      amount_delta_ngn: money(p.delta),
      is_within_fx_threshold: p.within_fx,
      match_evidence: p.evidence,
      created_at: iso(p.created_at),
    },
    a: summaryOf(p.a),
    b: summaryOf(p.b),
    discrepancies: discs.filter((d) => d.pair?.id === p.id).map(linked),
  };
}

// ── Pipeline runs ────────────────────────────────────────────────────────────

let runsCache: PipelineRun[] | null = null;

function buildRuns(): PipelineRun[] {
  const runs: PipelineRun[] = [];
  const add = (flow_name: string, start: number, seconds: number | null, processed: number, failed = 0, error: string | null = null, status?: PipelineRun['status'], triggered_by = 'scheduler') => {
    runs.push({
      id: uuid(),
      flow_name,
      status: status ?? (error ? 'failed' : 'completed'),
      triggered_by,
      started_at: iso(start),
      completed_at: seconds === null ? null : iso(start + seconds * SECOND),
      duration_seconds: seconds,
      records_processed: processed,
      records_failed: failed,
      error_message: error,
    });
  };

  const five = 5 * MINUTE;
  const lastMatch = Math.floor(NOW / five) * five;
  for (let t = lastMatch, i = 0; t > NOW - DAY; t -= five, i++) {
    const windowCount = txns.filter((x) => {
      const at = Date.parse(x.initiated_at);
      return at <= t && at > t - five;
    }).length;
    if (i === 37) add('silver-to-gold-matching-flow', t, 30.2, 0, windowCount, 'connection to server at "postgres", port 5432 failed: timeout expired');
    else add('silver-to-gold-matching-flow', t, Math.round(between(0.6, 4.8) * 10) / 10, windowCount);
  }
  const thirty = 30 * MINUTE;
  for (let t = Math.floor(NOW / thirty) * thirty, i = 0; t > NOW - DAY; t -= thirty, i++) {
    if (i === 9) add('fx-rate-capture-flow', t, 3.1, 0, 1, 'FX provider returned HTTP 429 (rate limited); will retry next run');
    else add('fx-rate-capture-flow', t + 2 * SECOND, Math.round(between(0.4, 1.6) * 10) / 10, 3);
  }
  const six = 6 * HOUR;
  for (let t = Math.floor(NOW / six) * six, i = 0; t > NOW - 3 * DAY; t -= six, i++) {
    if (i === 3) add('gap-detection-flow', t, 12.4, 0, 1, 'Flutterwave polling: HTTP 503 from /v3/transactions');
    else add('gap-detection-flow', t, Math.round(between(8, 40) * 10) / 10, intBetween(0, 4));
  }
  for (let d = 0; d < 14; d++) {
    const date = lagosDate(NOW - d * DAY);
    const start = Date.parse(`${date}T01:00:00Z`); // 02:00 WAT
    if (start > NOW) continue;
    add('daily-return-flow', start, Math.round(between(2, 9) * 10) / 10, 1);
  }
  const consumerStart = NOW - 2 * DAY - 3 * HOUR;
  runs.push({
    id: CONSUMER_RUN_ID,
    flow_name: 'bronze-to-silver-consumer',
    status: 'running',
    triggered_by: 'consumer_worker',
    started_at: iso(consumerStart),
    completed_at: null,
    duration_seconds: null,
    records_processed: txns.filter((x) => Date.parse(x.initiated_at) >= consumerStart).length,
    records_failed: 0,
    error_message: null,
  });
  add('bronze-to-silver-consumer', consumerStart - 9 * DAY, 9 * 86_400 - 40, 2410, 0, null, 'cancelled', 'manual');
  add('silver-to-gold-matching-flow', NOW - 26 * HOUR, 5.6, 112, 0, null, 'completed', 'manual');

  return runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export async function pipelineRuns({ limit, flow_name }: { limit: number; flow_name?: string }): Promise<PipelineRunsResponse> {
  await latency();
  runsCache ??= buildRuns();
  return { runs: runsCache.filter((r) => !flow_name || r.flow_name === flow_name).slice(0, limit) };
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function search(q: string): Promise<SearchResponse> {
  await latency(140);
  const term = q.trim().toUpperCase();
  if (term.length < MIN_SEARCH_LENGTH) throw new ApiError(422, `Query must be at least ${MIN_SEARCH_LENGTH} characters`);
  const results: SearchResult[] = [];
  for (const t of txns) {
    if (results.length >= 12) break;
    if (t.psp_transaction_ref.toUpperCase().startsWith(term) || t.id.toUpperCase().startsWith(term)) {
      results.push({ kind: 'transaction', id: t.id, title: t.psp_transaction_ref, subtitle: `${pspDisplayName(t.psp_name)} · ${humanize(t.transaction_type)} · ${formatNgn(t.amount_ngn)}` });
    }
  }
  for (const d of discs) {
    if (results.length >= 17) break;
    if (d.id.toUpperCase().startsWith(term) || d.txn.psp_transaction_ref.toUpperCase().startsWith(term)) {
      results.push({ kind: 'discrepancy', id: d.id, title: humanize(d.type), subtitle: `${d.txn.psp_transaction_ref} · ${humanize(d.status)} · ${formatNgn(money(d.exposure))}` });
    }
  }
  for (const p of allPairs) {
    if (results.length >= 20) break;
    if (p.id.toUpperCase().startsWith(term)) {
      results.push({ kind: 'pair', id: p.id, title: `${p.a.psp_transaction_ref} ↔ ${p.b.psp_transaction_ref}`, subtitle: `${strategyLabel(p.match_strategy)} · confidence ${formatScore(p.confidence)}` });
    }
  }
  return { results: results.slice(0, 20) };
}

export function readiness(): ReadinessBody {
  return {
    status: 'healthy',
    version: 'demo',
    checks: {
      postgres: { status: 'demo', error: 'Demo mode: no database is queried' },
      redpanda: { status: 'demo', error: 'Demo mode: no broker is queried' },
      minio: { status: 'demo', error: 'Demo mode: no object store is queried' },
    },
  };
}
