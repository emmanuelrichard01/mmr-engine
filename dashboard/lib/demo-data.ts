// ─── MMR Demo Data Layer ──────────────────────────────────────────────────────
// Realistic mock data for the reconciliation dashboard.
// All monetary amounts in Nigerian Naira (NGN) unless otherwise noted.

// ─── Type Definitions ─────────────────────────────────────────────────────────

export interface DailySummary {
  date: string;
  matchRate: number;
  volume: number;
  exposure: number;
  discrepancyCount: number;
  transactionsProcessed: number;
}

export interface Discrepancy {
  id: string;
  type:
    | 'missing_settlement'
    | 'amount_mismatch'
    | 'fx_variance'
    | 'duplicate_credit'
    | 'late_settlement';
  severity: 'critical' | 'high' | 'medium' | 'low';
  psp: 'paystack' | 'flutterwave' | 'mpesa';
  amount: number;
  currency: string;
  reference: string;
  beneficiaryName: string;
  status: 'open' | 'investigating' | 'resolved';
  createdAt: string;
  ageHours: number;
}

export interface PSPHealth {
  name: string;
  displayName: string;
  status: 'connected' | 'degraded' | 'disconnected';
  volumeToday: number;
  matchRate: number;
  avgSettlementHours: number;
  webhookGapRate: number;
  lastWebhookAt: string;
  transactionsToday: number;
}

export interface FXRate {
  date: string;
  ngnUsd: number;
  ngnGbp: number;
  ngnKes: number;
}

export interface KPIMetric {
  value: number;
  delta: number;
  trend: number[];
}

export interface KPISummary {
  matchRate: KPIMetric;
  openExposure: KPIMetric;
  pendingIssues: KPIMetric;
  txnsToday: KPIMetric;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

// ─── Nigerian Names & References ──────────────────────────────────────────────

const nigerianNames = [
  'Adebayo Ogundimu',
  'Chidinma Okafor',
  'Emeka Nwosu',
  'Fatima Abdullahi',
  'Ifeanyi Eze',
  'Kemi Adeyemi',
  'Oluwaseun Bakare',
  'Ngozi Ibe',
  'Tunde Ajayi',
  'Amina Yusuf',
  'Chinedu Okoro',
  'Bolaji Fashola',
  'Yetunde Adeola',
  'Uche Madueke',
  'Ibrahim Musa',
  'Funke Oladipo',
  'Segun Akinwale',
  'Halima Bello',
  'Obiora Nnamdi',
  'Aisha Suleiman',
  'Damilola Ogun',
  'Chukwuma Ike',
  'Folashade Coker',
  'Kingsley Igwe',
  'Zainab Mohammed',
];

const pspOptions: ('paystack' | 'flutterwave' | 'mpesa')[] = [
  'paystack',
  'flutterwave',
  'mpesa',
];

const discrepancyTypes: Discrepancy['type'][] = [
  'missing_settlement',
  'amount_mismatch',
  'fx_variance',
  'duplicate_credit',
  'late_settlement',
];

const severities: Discrepancy['severity'][] = [
  'critical',
  'high',
  'medium',
  'low',
];

const statuses: Discrepancy['status'][] = ['open', 'investigating', 'resolved'];

// ─── Daily Summaries (30 days) ────────────────────────────────────────────────

function generateDailySummaries(): DailySummary[] {
  const summaries: DailySummary[] = [];

  for (let i = 29; i >= 0; i--) {
    const baseVolume = 450_000_000 + rand() * 200_000_000;
    const matchRate = 94 + rand() * 5.5;
    const discrepancyCount = Math.floor(3 + rand() * 12);
    const exposure = baseVolume * (1 - matchRate / 100) * (0.3 + rand() * 0.4);
    const transactionsProcessed = Math.floor(8000 + rand() * 7000);

    summaries.push({
      date: daysAgo(i),
      matchRate: Math.round(matchRate * 100) / 100,
      volume: Math.round(baseVolume),
      exposure: Math.round(exposure),
      discrepancyCount,
      transactionsProcessed,
    });
  }

  return summaries;
}

// ─── Discrepancies (25 items) ─────────────────────────────────────────────────

function generateDiscrepancies(): Discrepancy[] {
  const items: Discrepancy[] = [];

  const amounts = [
    2_450_000, 185_000, 12_750_000, 890_500, 45_000, 3_200_000, 567_800,
    1_100_000, 78_900, 6_543_210, 234_567, 9_870_000, 456_123, 2_345_678,
    1_234_500, 678_900, 345_678, 8_901_234, 567_890, 123_456, 4_567_890,
    789_012, 3_456_789, 234_500, 5_678_901,
  ];

  const ageDistribution = [
    2, 4, 6, 8, 12, 1, 18, 24, 36, 48, 3, 72, 5, 96, 14, 120, 7, 144, 168,
    10, 192, 216, 240, 15, 0.5,
  ];

  for (let i = 0; i < 25; i++) {
    const ageH = ageDistribution[i];
    // Weight severity: more recent → more likely critical
    const sevIdx =
      ageH < 6
        ? Math.floor(rand() * 2)
        : ageH < 48
          ? Math.floor(1 + rand() * 2)
          : Math.floor(2 + rand() * 2);
    const statIdx =
      ageH > 120
        ? 2
        : ageH > 48
          ? Math.floor(rand() * 2) + 1
          : Math.floor(rand() * 2);

    items.push({
      id: `DIS-${String(1000 + i).padStart(4, '0')}`,
      type: discrepancyTypes[Math.floor(rand() * discrepancyTypes.length)],
      severity: severities[Math.min(sevIdx, 3)],
      psp: pspOptions[Math.floor(rand() * pspOptions.length)],
      amount: amounts[i],
      currency: 'NGN',
      reference: `TXN-${Date.now().toString(36).toUpperCase()}-${String(i).padStart(3, '0')}`,
      beneficiaryName: nigerianNames[i],
      status: statuses[Math.min(statIdx, 2)],
      createdAt: hoursAgo(ageH),
      ageHours: ageH,
    });
  }

  return items;
}

// ─── PSP Health Records ───────────────────────────────────────────────────────

function generatePSPHealth(): PSPHealth[] {
  return [
    {
      name: 'paystack',
      displayName: 'Paystack',
      status: 'connected',
      volumeToday: 245_670_000,
      matchRate: 98.4,
      avgSettlementHours: 2.3,
      webhookGapRate: 0.12,
      lastWebhookAt: hoursAgo(0.05),
      transactionsToday: 5_420,
    },
    {
      name: 'flutterwave',
      displayName: 'Flutterwave',
      status: 'degraded',
      volumeToday: 189_340_000,
      matchRate: 94.7,
      avgSettlementHours: 4.1,
      webhookGapRate: 2.34,
      lastWebhookAt: hoursAgo(0.8),
      transactionsToday: 3_890,
    },
    {
      name: 'mpesa',
      displayName: 'M-Pesa',
      status: 'connected',
      volumeToday: 67_890_000,
      matchRate: 97.1,
      avgSettlementHours: 6.8,
      webhookGapRate: 0.45,
      lastWebhookAt: hoursAgo(0.2),
      transactionsToday: 1_230,
    },
  ];
}

// ─── FX Rate History (30 days) ────────────────────────────────────────────────

function generateFXRates(): FXRate[] {
  const rates: FXRate[] = [];
  let ngnUsd = 1580;
  let ngnGbp = 1990;
  let ngnKes = 11.5;

  for (let i = 29; i >= 0; i--) {
    // Simulate realistic small daily FX movements
    ngnUsd += (rand() - 0.48) * 15;
    ngnGbp += (rand() - 0.48) * 20;
    ngnKes += (rand() - 0.48) * 0.3;

    rates.push({
      date: daysAgo(i),
      ngnUsd: Math.round(ngnUsd * 100) / 100,
      ngnGbp: Math.round(ngnGbp * 100) / 100,
      ngnKes: Math.round(ngnKes * 100) / 100,
    });
  }

  return rates;
}

// ─── Cached Instances ─────────────────────────────────────────────────────────

let _dailySummaries: DailySummary[] | null = null;
let _discrepancies: Discrepancy[] | null = null;
let _pspHealth: PSPHealth[] | null = null;
let _fxRates: FXRate[] | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function getDailySummaries(): DailySummary[] {
  if (!_dailySummaries) _dailySummaries = generateDailySummaries();
  return _dailySummaries;
}

export function getDiscrepancies(): Discrepancy[] {
  if (!_discrepancies) _discrepancies = generateDiscrepancies();
  return _discrepancies;
}

export function getPSPHealth(): PSPHealth[] {
  if (!_pspHealth) _pspHealth = generatePSPHealth();
  return _pspHealth;
}

export function getFXRates(): FXRate[] {
  if (!_fxRates) _fxRates = generateFXRates();
  return _fxRates;
}

export function getKPISummary(): KPISummary {
  const summaries = getDailySummaries();
  const discrepancies = getDiscrepancies();
  const pspHealth = getPSPHealth();

  const today = summaries[summaries.length - 1];
  const yesterday = summaries[summaries.length - 2];

  const openDiscrepancies = discrepancies.filter(
    (d) => d.status !== 'resolved'
  );
  const yesterdayOpen = Math.floor(openDiscrepancies.length * 1.15);

  const totalTransactionsToday = pspHealth.reduce(
    (sum, p) => sum + p.transactionsToday,
    0
  );
  const yesterdayTransactions = yesterday.transactionsProcessed;

  // Sparkline trends from last 7 days
  const recentSummaries = summaries.slice(-7);
  const matchRateTrend = recentSummaries.map((s) => s.matchRate);
  const exposureTrend = recentSummaries.map((s) => s.exposure);
  const discrepancyTrend = recentSummaries.map((s) => s.discrepancyCount);
  const txnTrend = recentSummaries.map((s) => s.transactionsProcessed);

  return {
    matchRate: {
      value: today.matchRate,
      delta:
        Math.round((today.matchRate - yesterday.matchRate) * 100) / 100,
      trend: matchRateTrend,
    },
    openExposure: {
      value: today.exposure,
      delta:
        Math.round(
          ((today.exposure - yesterday.exposure) / yesterday.exposure) * 10000
        ) / 100,
      trend: exposureTrend,
    },
    pendingIssues: {
      value: openDiscrepancies.length,
      delta: openDiscrepancies.length - yesterdayOpen,
      trend: discrepancyTrend,
    },
    txnsToday: {
      value: totalTransactionsToday,
      delta:
        Math.round(
          ((totalTransactionsToday - yesterdayTransactions) /
            yesterdayTransactions) *
            10000
        ) / 100,
      trend: txnTrend,
    },
  };
}

