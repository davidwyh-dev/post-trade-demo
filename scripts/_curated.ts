// The 12 hand-curated demo positions, extracted as pure data so both the
// fast `npm run seed` (just these 12) and `npm run seed:bulk` (these + 1988
// generated) can iterate the same list.
//
// Each ticket = a position params object + an ordered list of post-NEW events
// to apply via FLOW_REGISTRY.

import type { IrsParams, FutureParams, TreasuryParams, FxParams } from '../lib/positions/params';
import type { FlowName } from '../lib/positions/flows';

export type CuratedEvent = { flow: FlowName; payload: Record<string, unknown> };
export type CuratedTicket = {
  params: IrsParams | FutureParams | TreasuryParams | FxParams;
  events: CuratedEvent[];
};

export const CURATED_TICKETS: CuratedTicket[] = [
  // ============ IRS ============
  {
    params: {
      product: 'IRS', currency: 'USD', notional: 250_000_000, fixedRate: 4.25,
      payReceive: 'PAY_FIXED', effectiveDate: '2025-11-15', maturityDate: '2030-11-15',
      floatingIndex: 'SOFR', counterparty: 'JPM', paymentFreqMonths: 3,
    },
    events: [
      { flow: 'RATE_RESET', payload: { resetDate: '2026-02-15', fixingRate: 4.41,
          accrualStartDate: '2026-02-15', accrualEndDate: '2026-05-15' } },
      { flow: 'RATE_RESET', payload: { resetDate: '2026-05-15', fixingRate: 4.36,
          accrualStartDate: '2026-05-15', accrualEndDate: '2026-08-15' } },
      { flow: 'AMEND', payload: { newNotional: 200_000_000, reason: 'partial unwind via novation' } },
    ],
  },
  {
    params: {
      product: 'IRS', currency: 'EUR', notional: 100_000_000, fixedRate: 2.85,
      payReceive: 'RECV_FIXED', effectiveDate: '2026-01-10', maturityDate: '2028-01-10',
      floatingIndex: 'ESTR', counterparty: 'DB', paymentFreqMonths: 6,
    },
    events: [
      { flow: 'RATE_RESET', payload: { resetDate: '2026-04-10', fixingRate: 2.62,
          accrualStartDate: '2026-04-10', accrualEndDate: '2026-10-10' } },
    ],
  },
  {
    params: {
      product: 'IRS', currency: 'GBP', notional: 75_000_000, fixedRate: 4.10,
      payReceive: 'PAY_FIXED', effectiveDate: '2024-08-20', maturityDate: '2027-08-20',
      floatingIndex: 'SONIA', counterparty: 'BARC', paymentFreqMonths: 3,
    },
    events: [
      { flow: 'NOVATION', payload: { fromCounterparty: 'BARC', toCounterparty: 'HSBC',
          novationDate: '2026-03-15' } },
    ],
  },

  // ============ FUTURES ============
  {
    params: {
      product: 'FUTURE', contractCode: 'FVH6', exchange: 'CBOT', account: 'MAIN',
      initialContracts: 500, expiryDate: '2026-03-31', multiplier: 1000, tickSize: 0.0078125,
      description: '5Y US Treasury Note Mar 2026',
    },
    events: [
      { flow: 'AMEND', payload: { newQuantity: 750, reason: 'top-up to target' } },
    ],
  },
  {
    params: {
      product: 'FUTURE', contractCode: 'EDM6', exchange: 'CME', account: 'MACRO',
      initialContracts: -200, expiryDate: '2026-06-15', multiplier: 2500, tickSize: 0.0025,
      description: '3M SOFR Jun 2026',
    },
    events: [],
  },
  {
    params: {
      product: 'FUTURE', contractCode: 'FGBL Z5', exchange: 'EUREX', account: 'MAIN',
      initialContracts: 300, expiryDate: '2025-12-08', multiplier: 1000, tickSize: 0.01,
      description: 'Euro Bund Dec 2025',
    },
    events: [
      { flow: 'EXPIRY', payload: { expiryDate: '2025-12-08', finalSettlement: 132.45,
          finalSettlementCcy: 'EUR' } },
    ],
  },

  // ============ TREASURIES ============
  {
    params: {
      product: 'TREASURY', isin: 'US912828YY08', issuer: 'US Treasury', currency: 'USD',
      coupon: 4.0, maturityDate: '2030-08-15', side: 'LONG', account: 'MAIN',
      initialFaceAmount: 50_000_000,
    },
    events: [
      { flow: 'COUPON', payload: { paymentDate: '2026-02-15', amount: 1_000_000, currency: 'USD' } },
      { flow: 'COUPON', payload: { paymentDate: '2026-08-15', amount: 1_000_000, currency: 'USD' } },
    ],
  },
  {
    params: {
      product: 'TREASURY', isin: 'DE0001102614', issuer: 'Bund', currency: 'EUR',
      coupon: 2.5, maturityDate: '2034-02-15', side: 'LONG', account: 'MACRO',
      initialFaceAmount: 30_000_000,
    },
    events: [],
  },
  {
    params: {
      product: 'TREASURY', isin: 'GB00BMBL1D50', issuer: 'UK Gilt', currency: 'GBP',
      coupon: 4.625, maturityDate: '2034-01-31', side: 'SHORT', account: 'MAIN',
      initialFaceAmount: 20_000_000,
    },
    events: [
      { flow: 'AMEND', payload: { newNotional: 15_000_000, reason: 'cover' } },
    ],
  },

  // ============ FX ============
  {
    params: {
      product: 'FX', pair: 'EUR/USD', baseCurrency: 'EUR', quoteCurrency: 'USD',
      kind: 'SPOT', valueDate: '2026-05-06', notionalBase: 25_000_000, rate: 1.0875,
      counterparty: 'GS',
    },
    events: [],
  },
  {
    params: {
      product: 'FX', pair: 'USD/JPY', baseCurrency: 'USD', quoteCurrency: 'JPY',
      kind: 'FORWARD', valueDate: '2026-08-04', notionalBase: 50_000_000, rate: 152.30,
      counterparty: 'MS',
    },
    events: [
      { flow: 'ROLL', payload: { fromValueDate: '2026-08-04', toValueDate: '2026-11-04',
          fromRate: 152.30, toRate: 151.85 } },
    ],
  },
  {
    params: {
      product: 'FX', pair: 'GBP/USD', baseCurrency: 'GBP', quoteCurrency: 'USD',
      kind: 'SWAP', valueDate: '2026-05-08', notionalBase: 15_000_000, rate: 1.2615,
      farValueDate: '2026-08-08', farRate: 1.2588,
      counterparty: 'BARC',
    },
    events: [
      { flow: 'TERMINATION', payload: { terminationDate: '2026-06-12',
          settlementAmount: 42_500, currency: 'USD' } },
    ],
  },
];
