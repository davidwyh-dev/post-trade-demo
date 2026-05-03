// Procedural generators for the bulk seed. All randomness flows through a
// seeded RNG so the same --seed value reproduces the same dataset.

import {
  G10_CURRENCIES, RFR_BY_CCY, FX_KINDS, PAY_RECEIVE, SIDES, FUTURES_EXCHANGES,
  type G10Currency,
} from '../lib/constants';
import type {
  IrsParams, FutureParams, TreasuryParams, FxParams,
} from '../lib/positions/params';
import type { FlowName } from '../lib/positions/flows';

// ============ RNG ============

// mulberry32: tiny seeded PRNG. Deterministic for a given seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const rangeInt = (rng: Rng, lo: number, hi: number): number =>
  Math.floor(rng() * (hi - lo + 1)) + lo;
const rangeFloat = (rng: Rng, lo: number, hi: number): number =>
  rng() * (hi - lo) + lo;
const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

// ============ Generated ticket type ============

export type GeneratedEvent = { flow: FlowName; payload: Record<string, unknown> };
export type GeneratedTicket = {
  params: IrsParams | FutureParams | TreasuryParams | FxParams;
  openedAt: Date;
  events: GeneratedEvent[];
  // Set when a terminal event (TERMINATION/EXPIRY/CANCEL) is included so the
  // bulk seed can backdate closed_at to match the event's effective date
  // (the flow itself uses now() — the bulk seed overrides via UPDATE).
  closedAt?: Date;
};

// ============ Date helpers ============

const MS_PER_DAY = 86_400_000;
const COUNTERPARTIES = ['JPM','GS','MS','BAML','CITI','BARC','DB','UBS','HSBC','BNP','SG'] as const;
const ACCOUNTS = ['MAIN','MACRO','RATES','FX-DESK','HEDGE'] as const;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * MS_PER_DAY);
const addMonths = (d: Date, months: number): Date => {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};

// ============ IRS ============

function generateIrs(rng: Rng, openedAt: Date, today: Date): GeneratedTicket {
  const currency = pick(rng, G10_CURRENCIES);
  const floatingIndex = RFR_BY_CCY[currency] as IrsParams['floatingIndex'];
  const tenorYears = rangeInt(rng, 1, 10);
  const maturityDate = addMonths(openedAt, tenorYears * 12);
  const paymentFreqMonths = pick(rng, [3, 6] as const);

  const params: IrsParams = {
    product: 'IRS',
    currency,
    notional: roundTo(rangeInt(rng, 10, 500) * 1_000_000, 5_000_000),
    fixedRate: Number(rangeFloat(rng, 1.0, 5.5).toFixed(3)),
    payReceive: pick(rng, PAY_RECEIVE),
    effectiveDate: iso(openedAt),
    maturityDate: iso(maturityDate),
    floatingIndex,
    counterparty: pick(rng, COUNTERPARTIES),
    paymentFreqMonths,
  };

  const events: GeneratedEvent[] = [];
  const horizon = maturityDate.getTime() < today.getTime() ? maturityDate : today;
  let cursor = addMonths(openedAt, paymentFreqMonths);
  let resets = 0;
  while (cursor.getTime() <= horizon.getTime() && resets < 8) {
    const accrualEnd = addMonths(cursor, paymentFreqMonths);
    events.push({
      flow: 'RATE_RESET',
      payload: {
        resetDate: iso(cursor),
        fixingRate: Number((params.fixedRate + rangeFloat(rng, -0.5, 0.5)).toFixed(3)),
        accrualStartDate: iso(cursor),
        accrualEndDate: iso(accrualEnd),
        effectiveAt: cursor.toISOString(),
      },
    });
    cursor = accrualEnd;
    resets++;
  }

  // 15% AMEND mid-life
  if (rng() < 0.15 && today.getTime() - openedAt.getTime() > 60 * MS_PER_DAY) {
    const amendDate = randomBetween(rng, addDays(openedAt, 30), today);
    events.push({
      flow: 'AMEND',
      payload: {
        newNotional: roundTo(params.notional * rangeFloat(rng, 0.5, 1.4), 5_000_000),
        reason: 'rebalance',
        effectiveAt: amendDate.toISOString(),
      },
    });
  }

  // 5% NOVATION
  if (rng() < 0.05 && today.getTime() - openedAt.getTime() > 60 * MS_PER_DAY) {
    let toCp = pick(rng, COUNTERPARTIES);
    while (toCp === params.counterparty) toCp = pick(rng, COUNTERPARTIES);
    const novDate = randomBetween(rng, addDays(openedAt, 30), today);
    events.push({
      flow: 'NOVATION',
      payload: {
        fromCounterparty: params.counterparty,
        toCounterparty: toCp,
        novationDate: iso(novDate),
        effectiveAt: novDate.toISOString(),
      },
    });
  }

  // 3% TERMINATION (terminal)
  let closedAt: Date | undefined;
  if (rng() < 0.03 && today.getTime() - openedAt.getTime() > 60 * MS_PER_DAY) {
    const termDate = randomBetween(rng, addDays(openedAt, 60), today);
    events.push({
      flow: 'TERMINATION',
      payload: {
        terminationDate: iso(termDate),
        settlementAmount: Number(rangeFloat(rng, -200_000, 200_000).toFixed(2)),
        currency,
        effectiveAt: termDate.toISOString(),
      },
    });
    closedAt = termDate;
  }

  return { params, openedAt, events, closedAt };
}

// ============ FUTURES ============

const FUTURE_TEMPLATES = [
  { code: 'FV',   exch: 'CBOT'  as const, mult: 1000, tick: 0.0078125, desc: '5Y US Note' },
  { code: 'TY',   exch: 'CBOT'  as const, mult: 1000, tick: 0.015625,  desc: '10Y US Note' },
  { code: 'US',   exch: 'CBOT'  as const, mult: 1000, tick: 0.03125,   desc: '30Y US Bond' },
  { code: 'ED',   exch: 'CME'   as const, mult: 2500, tick: 0.0025,    desc: '3M Eurodollar' },
  { code: 'SR3',  exch: 'CME'   as const, mult: 2500, tick: 0.0025,    desc: '3M SOFR' },
  { code: 'ES',   exch: 'CME'   as const, mult: 50,   tick: 0.25,      desc: 'E-mini S&P 500' },
  { code: 'FGBL', exch: 'EUREX' as const, mult: 1000, tick: 0.01,      desc: 'Euro Bund' },
  { code: 'FGBM', exch: 'EUREX' as const, mult: 1000, tick: 0.01,      desc: 'Euro Bobl' },
  { code: 'FGBS', exch: 'EUREX' as const, mult: 1000, tick: 0.005,     desc: 'Euro Schatz' },
  { code: 'L',    exch: 'LIFFE' as const, mult: 2500, tick: 0.005,     desc: '3M SONIA' },
  { code: 'JGB',  exch: 'TFX'   as const, mult: 100_000_000, tick: 0.01, desc: '10Y JGB' },
];
// All 12 futures month codes (F=Jan ... Z=Dec).
const MONTH_LETTERS = ['F','G','H','J','K','M','N','Q','U','V','X','Z'] as const;

function generateFuture(rng: Rng, openedAt: Date, today: Date): GeneratedTicket {
  const tmpl = pick(rng, FUTURE_TEMPLATES);
  const expiryDate = addDays(openedAt, rangeInt(rng, 30, 540));
  const monthLetter = MONTH_LETTERS[expiryDate.getUTCMonth()];
  // Two-digit year suffix widens the key space ~10x vs single digit, which
  // matters because (contractCode, exchange, account) is the position key.
  const yearSuffix = String(expiryDate.getUTCFullYear() % 100).padStart(2, '0');
  const contractCode = `${tmpl.code}${monthLetter}${yearSuffix}`;

  const sign = rng() < 0.5 ? 1 : -1;
  const initialContracts = sign * rangeInt(rng, 50, 2000);

  const params: FutureParams = {
    product: 'FUTURE',
    contractCode,
    exchange: tmpl.exch,
    account: pick(rng, ACCOUNTS),
    initialContracts,
    expiryDate: iso(expiryDate),
    multiplier: tmpl.mult,
    tickSize: tmpl.tick,
    description: tmpl.desc,
  };

  const events: GeneratedEvent[] = [];

  // 20% AMEND
  if (rng() < 0.20 && today.getTime() - openedAt.getTime() > 7 * MS_PER_DAY) {
    const amendDate = randomBetween(rng, addDays(openedAt, 7), today);
    events.push({
      flow: 'AMEND',
      payload: {
        newQuantity: sign * rangeInt(rng, 50, 2500),
        reason: 'rebalance',
        effectiveAt: amendDate.toISOString(),
      },
    });
  }

  // EXPIRY if expired (terminal)
  let closedAt: Date | undefined;
  if (expiryDate.getTime() <= today.getTime()) {
    events.push({
      flow: 'EXPIRY',
      payload: {
        expiryDate: iso(expiryDate),
        finalSettlement: Number(rangeFloat(rng, 95, 135).toFixed(4)),
        finalSettlementCcy: 'USD',
        effectiveAt: expiryDate.toISOString(),
      },
    });
    closedAt = expiryDate;
  }

  return { params, openedAt, events, closedAt };
}

// ============ TREASURIES ============

const TREASURY_COUNTRIES = [
  { prefix: 'US', issuer: 'US Treasury',  currency: 'USD' as G10Currency },
  { prefix: 'DE', issuer: 'Bund',         currency: 'EUR' as G10Currency },
  { prefix: 'GB', issuer: 'UK Gilt',      currency: 'GBP' as G10Currency },
  { prefix: 'FR', issuer: 'OAT',          currency: 'EUR' as G10Currency },
  { prefix: 'IT', issuer: 'BTP',          currency: 'EUR' as G10Currency },
  { prefix: 'JP', issuer: 'JGB',          currency: 'JPY' as G10Currency },
  { prefix: 'CA', issuer: 'Canada Bond',  currency: 'CAD' as G10Currency },
  { prefix: 'AU', issuer: 'ACGB',         currency: 'AUD' as G10Currency },
];
const ISIN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomIsin(rng: Rng, prefix: string): string {
  let body = '';
  for (let i = 0; i < 9; i++) body += ISIN_CHARS[Math.floor(rng() * ISIN_CHARS.length)];
  const checkDigit = Math.floor(rng() * 10);
  return `${prefix}${body}${checkDigit}`;
}

function generateTreasury(rng: Rng, openedAt: Date, today: Date): GeneratedTicket {
  const country = pick(rng, TREASURY_COUNTRIES);
  const tenorYears = rangeInt(rng, 2, 30);
  const maturityDate = addMonths(openedAt, tenorYears * 12);

  const params: TreasuryParams = {
    product: 'TREASURY',
    isin: randomIsin(rng, country.prefix),
    issuer: country.issuer,
    currency: country.currency,
    coupon: Number(rangeFloat(rng, 0.5, 6.0).toFixed(3)),
    maturityDate: iso(maturityDate),
    side: pick(rng, SIDES),
    account: pick(rng, ACCOUNTS),
    initialFaceAmount: roundTo(rangeInt(rng, 5, 100) * 1_000_000, 1_000_000),
  };

  const events: GeneratedEvent[] = [];
  const horizon = maturityDate.getTime() < today.getTime() ? maturityDate : today;
  let cursor = addMonths(openedAt, 6);
  let coupons = 0;
  while (cursor.getTime() <= horizon.getTime() && coupons < 6) {
    events.push({
      flow: 'COUPON',
      payload: {
        paymentDate: iso(cursor),
        amount: Number((params.initialFaceAmount * params.coupon / 200).toFixed(2)),
        currency: params.currency,
        effectiveAt: cursor.toISOString(),
      },
    });
    cursor = addMonths(cursor, 6);
    coupons++;
  }

  let closedAt: Date | undefined;
  if (rng() < 0.05 && today.getTime() - openedAt.getTime() > 60 * MS_PER_DAY) {
    const termDate = randomBetween(rng, addDays(openedAt, 60), today);
    events.push({
      flow: 'TERMINATION',
      payload: {
        terminationDate: iso(termDate),
        settlementAmount: Number(rangeFloat(rng, -500_000, 500_000).toFixed(2)),
        currency: params.currency,
        effectiveAt: termDate.toISOString(),
      },
    });
    closedAt = termDate;
  } else if (rng() < 0.02 && today.getTime() - openedAt.getTime() > 30 * MS_PER_DAY) {
    const cancelDate = randomBetween(rng, addDays(openedAt, 1), addDays(openedAt, 30));
    events.push({
      flow: 'CANCEL',
      payload: {
        reason: 'trade booking error',
        effectiveAt: cancelDate.toISOString(),
      },
    });
    closedAt = cancelDate;
  }

  return { params, openedAt, events, closedAt };
}

// ============ FX ============

const FX_PAIRS: ReadonlyArray<{ base: G10Currency; quote: G10Currency; lo: number; hi: number }> = [
  { base: 'EUR', quote: 'USD', lo: 1.05,  hi: 1.20  },
  { base: 'GBP', quote: 'USD', lo: 1.20,  hi: 1.40  },
  { base: 'USD', quote: 'JPY', lo: 130,   hi: 160   },
  { base: 'AUD', quote: 'USD', lo: 0.60,  hi: 0.75  },
  { base: 'NZD', quote: 'USD', lo: 0.55,  hi: 0.70  },
  { base: 'USD', quote: 'CAD', lo: 1.30,  hi: 1.45  },
  { base: 'USD', quote: 'CHF', lo: 0.85,  hi: 0.98  },
  { base: 'EUR', quote: 'GBP', lo: 0.83,  hi: 0.90  },
  { base: 'EUR', quote: 'JPY', lo: 145,   hi: 175   },
  { base: 'USD', quote: 'SEK', lo: 9.5,   hi: 11.5  },
  { base: 'USD', quote: 'NOK', lo: 9.5,   hi: 11.5  },
];

function generateFx(rng: Rng, openedAt: Date, today: Date): GeneratedTicket {
  const p = pick(rng, FX_PAIRS);
  const kind = pick(rng, FX_KINDS);
  const valueOffsetDays = kind === 'SPOT' ? 2 : rangeInt(rng, 30, 365);
  const valueDate = addDays(openedAt, valueOffsetDays);
  const rate = Number(rangeFloat(rng, p.lo, p.hi).toFixed(5));

  const params: FxParams = {
    product: 'FX',
    pair: `${p.base}/${p.quote}`,
    baseCurrency: p.base,
    quoteCurrency: p.quote,
    kind,
    valueDate: iso(valueDate),
    notionalBase: roundTo(rangeInt(rng, 5, 100) * 1_000_000, 1_000_000),
    rate,
    counterparty: pick(rng, COUNTERPARTIES),
    ...(kind === 'SWAP' ? {
      farValueDate: iso(addDays(valueDate, rangeInt(rng, 30, 180))),
      farRate: Number((rate * rangeFloat(rng, 0.995, 1.005)).toFixed(5)),
    } : {}),
  };

  const events: GeneratedEvent[] = [];

  // FORWARD/SWAP can roll forward
  if (kind !== 'SPOT' && rng() < 0.30 && today.getTime() - openedAt.getTime() > 30 * MS_PER_DAY) {
    const rollDate = randomBetween(rng, addDays(openedAt, 7), today);
    const newValueDate = addDays(valueDate, rangeInt(rng, 30, 90));
    events.push({
      flow: 'ROLL',
      payload: {
        fromValueDate: iso(valueDate),
        toValueDate: iso(newValueDate),
        fromRate: rate,
        toRate: Number((rate * rangeFloat(rng, 0.995, 1.005)).toFixed(5)),
        effectiveAt: rollDate.toISOString(),
      },
    });
  }

  let closedAt: Date | undefined;
  if (rng() < 0.05 && today.getTime() - openedAt.getTime() > 30 * MS_PER_DAY) {
    const termDate = randomBetween(rng, addDays(openedAt, 14), today);
    events.push({
      flow: 'TERMINATION',
      payload: {
        terminationDate: iso(termDate),
        settlementAmount: Number(rangeFloat(rng, -100_000, 100_000).toFixed(2)),
        currency: p.quote,
        effectiveAt: termDate.toISOString(),
      },
    });
    closedAt = termDate;
  }

  return { params, openedAt, events, closedAt };
}

// ============ Main entry ============

function randomBetween(rng: Rng, lo: Date, hi: Date): Date {
  const span = hi.getTime() - lo.getTime();
  return new Date(lo.getTime() + Math.floor(rng() * span));
}

const PRODUCT_MIX: Array<['IRS' | 'FUTURE' | 'TREASURY' | 'FX', number]> = [
  ['IRS',      0.30],
  ['FUTURE',   0.25],
  ['TREASURY', 0.25],
  ['FX',       0.20],
];

export function generateTickets(count: number, rng: Rng, today: Date): GeneratedTicket[] {
  const tickets: GeneratedTicket[] = [];
  const twoYearsAgo = addDays(today, -730);
  const yesterday = addDays(today, -1);

  for (let i = 0; i < count; i++) {
    const openedAt = randomBetween(rng, twoYearsAgo, yesterday);
    const r = rng();
    let acc = 0;
    let chosen: 'IRS' | 'FUTURE' | 'TREASURY' | 'FX' = 'IRS';
    for (const [product, weight] of PRODUCT_MIX) {
      acc += weight;
      if (r < acc) { chosen = product; break; }
    }
    switch (chosen) {
      case 'IRS':      tickets.push(generateIrs(rng, openedAt, today)); break;
      case 'FUTURE':   tickets.push(generateFuture(rng, openedAt, today)); break;
      case 'TREASURY': tickets.push(generateTreasury(rng, openedAt, today)); break;
      case 'FX':       tickets.push(generateFx(rng, openedAt, today)); break;
    }
  }
  return tickets;
}
