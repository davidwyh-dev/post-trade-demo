import { describe, it, expect } from 'vitest';
import { computeKey } from '@/lib/positions/key';
import type { IrsParams, FutureParams, TreasuryParams, FxParams } from '@/lib/positions/params';

const baseIrs: IrsParams = {
  product: 'IRS',
  currency: 'USD',
  notional: 100_000_000,
  fixedRate: 4.25,
  payReceive: 'PAY_FIXED',
  effectiveDate: '2026-05-04',
  maturityDate: '2031-05-04',
  floatingIndex: 'SOFR',
  counterparty: 'JPM',
  paymentFreqMonths: 3,
};

describe('computeKey — determinism', () => {
  it('same params produce the same key', () => {
    expect(computeKey(baseIrs)).toBe(computeKey({ ...baseIrs }));
  });

  it('key is independent of the source object key order', () => {
    const reordered = {
      paymentFreqMonths: 3,
      counterparty: 'JPM',
      floatingIndex: 'SOFR',
      maturityDate: '2031-05-04',
      effectiveDate: '2026-05-04',
      payReceive: 'PAY_FIXED',
      fixedRate: 4.25,
      notional: 100_000_000,
      currency: 'USD',
      product: 'IRS',
    } as IrsParams;
    expect(computeKey(reordered)).toBe(computeKey(baseIrs));
  });

  it('counterparty case is normalized', () => {
    expect(computeKey({ ...baseIrs, counterparty: 'jpm' })).toBe(computeKey(baseIrs));
  });

  it('numeric fixedRate is normalized to fixed precision', () => {
    expect(computeKey({ ...baseIrs, fixedRate: 4.25000000001 })).toBe(computeKey(baseIrs));
  });
});

describe('computeKey — uniqueness', () => {
  it('IRS: different fixedRate → different key', () => {
    expect(computeKey({ ...baseIrs, fixedRate: 4.50 })).not.toBe(computeKey(baseIrs));
  });

  it('IRS: different notional → SAME key (notional is amendable, not key-defining)', () => {
    expect(computeKey({ ...baseIrs, notional: 50_000_000 })).toBe(computeKey(baseIrs));
  });

  it('IRS: different payReceive → different key', () => {
    expect(computeKey({ ...baseIrs, payReceive: 'RECV_FIXED' })).not.toBe(computeKey(baseIrs));
  });

  it('IRS: different counterparty → different key', () => {
    expect(computeKey({ ...baseIrs, counterparty: 'GS' })).not.toBe(computeKey(baseIrs));
  });
});

describe('computeKey — per-product', () => {
  it('Future: same contract+exchange+account, different quantity → same key', () => {
    const a: FutureParams = {
      product: 'FUTURE', contractCode: 'FVH6', exchange: 'CBOT', account: 'MAIN',
      initialContracts: 100, expiryDate: '2026-03-20', multiplier: 1000, tickSize: 0.0078125,
    };
    const b: FutureParams = { ...a, initialContracts: -50 };
    expect(computeKey(a)).toBe(computeKey(b));
  });

  it('Treasury: same ISIN+side+account, different counterparty → same key', () => {
    const a: TreasuryParams = {
      product: 'TREASURY', isin: 'US912828YY08', issuer: 'US Treasury', currency: 'USD',
      coupon: 4.0, maturityDate: '2030-08-15', side: 'LONG', account: 'MAIN',
      initialFaceAmount: 10_000_000,
    };
    expect(computeKey({ ...a, issuer: 'Treasury Direct' })).toBe(computeKey(a));
  });

  it('FX: different rate → SAME key (rate is event-level)', () => {
    const a: FxParams = {
      product: 'FX', pair: 'EUR/USD', baseCurrency: 'EUR', quoteCurrency: 'USD',
      kind: 'SPOT', valueDate: '2026-05-06', notionalBase: 25_000_000, rate: 1.0875,
      counterparty: 'GS',
    };
    expect(computeKey({ ...a, rate: 1.0900 })).toBe(computeKey(a));
  });

  it('different products with same field shape → different keys', () => {
    // Even if two params dicts happened to canonicalize identically,
    // the product is mixed into the hash input.
    const irs = computeKey(baseIrs);
    const future: FutureParams = {
      product: 'FUTURE', contractCode: 'X', exchange: 'CME', account: 'MAIN',
      initialContracts: 1, expiryDate: '2030-01-01', multiplier: 1, tickSize: 0.01,
    };
    expect(computeKey(future)).not.toBe(irs);
  });
});
