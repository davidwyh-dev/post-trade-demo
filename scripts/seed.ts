// Idempotent demo seed: wipes positions+events and re-inserts ~3 positions
// per product with a sprinkle of lifecycle events on each. Counterparties are
// preserved (they were inserted by drizzle/0001_seed_counterparties.sql).
//
//   npm run seed              # uses DATABASE_URL from .env.local
//
// Safe to run repeatedly; the TRUNCATE bypasses append-only triggers.

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getWriterSql } from '../lib/db/client';
import { createPosition } from '../lib/positions/create';
import { FLOW_REGISTRY } from '../lib/positions/flows';
import type { IrsParams, FutureParams, TreasuryParams, FxParams } from '../lib/positions/params';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const sql = getWriterSql();

  console.log('[seed] wiping positions + events...');
  await sql.unsafe(`TRUNCATE TABLE events, positions RESTART IDENTITY CASCADE;`);

  // ============ IRS ============
  const irs1: IrsParams = {
    product: 'IRS', currency: 'USD', notional: 250_000_000, fixedRate: 4.25,
    payReceive: 'PAY_FIXED', effectiveDate: '2025-11-15', maturityDate: '2030-11-15',
    floatingIndex: 'SOFR', counterparty: 'JPM', paymentFreqMonths: 3,
  };
  const { position: p1 } = await createPosition(sql, { params: irs1 });
  await FLOW_REGISTRY.RATE_RESET.run(sql, p1.id, {
    resetDate: '2026-02-15', fixingRate: 4.41,
    accrualStartDate: '2026-02-15', accrualEndDate: '2026-05-15',
  });
  await FLOW_REGISTRY.RATE_RESET.run(sql, p1.id, {
    resetDate: '2026-05-15', fixingRate: 4.36,
    accrualStartDate: '2026-05-15', accrualEndDate: '2026-08-15',
  });
  await FLOW_REGISTRY.AMEND.run(sql, p1.id, { newNotional: 200_000_000, reason: 'partial unwind via novation' });

  const irs2: IrsParams = {
    product: 'IRS', currency: 'EUR', notional: 100_000_000, fixedRate: 2.85,
    payReceive: 'RECV_FIXED', effectiveDate: '2026-01-10', maturityDate: '2028-01-10',
    floatingIndex: 'ESTR', counterparty: 'DB', paymentFreqMonths: 6,
  };
  const { position: p2 } = await createPosition(sql, { params: irs2 });
  await FLOW_REGISTRY.RATE_RESET.run(sql, p2.id, {
    resetDate: '2026-04-10', fixingRate: 2.62,
    accrualStartDate: '2026-04-10', accrualEndDate: '2026-10-10',
  });

  const irs3: IrsParams = {
    product: 'IRS', currency: 'GBP', notional: 75_000_000, fixedRate: 4.10,
    payReceive: 'PAY_FIXED', effectiveDate: '2024-08-20', maturityDate: '2027-08-20',
    floatingIndex: 'SONIA', counterparty: 'BARC', paymentFreqMonths: 3,
  };
  const { position: p3 } = await createPosition(sql, { params: irs3 });
  await FLOW_REGISTRY.NOVATION.run(sql, p3.id, {
    fromCounterparty: 'BARC', toCounterparty: 'HSBC', novationDate: '2026-03-15',
  });

  // ============ FUTURES ============
  const fut1: FutureParams = {
    product: 'FUTURE', contractCode: 'FVH6', exchange: 'CBOT', account: 'MAIN',
    initialContracts: 500, expiryDate: '2026-03-31', multiplier: 1000, tickSize: 0.0078125,
    description: '5Y US Treasury Note Mar 2026',
  };
  const { position: p4 } = await createPosition(sql, { params: fut1 });
  await FLOW_REGISTRY.AMEND.run(sql, p4.id, { newQuantity: 750, reason: 'top-up to target' });

  const fut2: FutureParams = {
    product: 'FUTURE', contractCode: 'EDM6', exchange: 'CME', account: 'MACRO',
    initialContracts: -200, expiryDate: '2026-06-15', multiplier: 2500, tickSize: 0.0025,
    description: '3M SOFR Jun 2026',
  };
  const { position: p5 } = await createPosition(sql, { params: fut2 });

  const fut3: FutureParams = {
    product: 'FUTURE', contractCode: 'FGBL Z5', exchange: 'EUREX', account: 'MAIN',
    initialContracts: 300, expiryDate: '2025-12-08', multiplier: 1000, tickSize: 0.01,
    description: 'Euro Bund Dec 2025',
  };
  const { position: p6 } = await createPosition(sql, { params: fut3 });
  await FLOW_REGISTRY.EXPIRY.run(sql, p6.id, {
    expiryDate: '2025-12-08', finalSettlement: 132.45, finalSettlementCcy: 'EUR',
  });

  // ============ TREASURIES ============
  const tsy1: TreasuryParams = {
    product: 'TREASURY', isin: 'US912828YY08', issuer: 'US Treasury', currency: 'USD',
    coupon: 4.0, maturityDate: '2030-08-15', side: 'LONG', account: 'MAIN',
    initialFaceAmount: 50_000_000,
  };
  const { position: p7 } = await createPosition(sql, { params: tsy1 });
  await FLOW_REGISTRY.COUPON.run(sql, p7.id, {
    paymentDate: '2026-02-15', amount: 1_000_000, currency: 'USD',
  });
  await FLOW_REGISTRY.COUPON.run(sql, p7.id, {
    paymentDate: '2026-08-15', amount: 1_000_000, currency: 'USD',
  });

  const tsy2: TreasuryParams = {
    product: 'TREASURY', isin: 'DE0001102614', issuer: 'Bund', currency: 'EUR',
    coupon: 2.5, maturityDate: '2034-02-15', side: 'LONG', account: 'MACRO',
    initialFaceAmount: 30_000_000,
  };
  await createPosition(sql, { params: tsy2 });

  const tsy3: TreasuryParams = {
    product: 'TREASURY', isin: 'GB00BMBL1D50', issuer: 'UK Gilt', currency: 'GBP',
    coupon: 4.625, maturityDate: '2034-01-31', side: 'SHORT', account: 'MAIN',
    initialFaceAmount: 20_000_000,
  };
  const { position: p9 } = await createPosition(sql, { params: tsy3 });
  await FLOW_REGISTRY.AMEND.run(sql, p9.id, { newNotional: 15_000_000, reason: 'cover' });

  // ============ FX ============
  const fx1: FxParams = {
    product: 'FX', pair: 'EUR/USD', baseCurrency: 'EUR', quoteCurrency: 'USD',
    kind: 'SPOT', valueDate: '2026-05-06', notionalBase: 25_000_000, rate: 1.0875,
    counterparty: 'GS',
  };
  await createPosition(sql, { params: fx1 });

  const fx2: FxParams = {
    product: 'FX', pair: 'USD/JPY', baseCurrency: 'USD', quoteCurrency: 'JPY',
    kind: 'FORWARD', valueDate: '2026-08-04', notionalBase: 50_000_000, rate: 152.30,
    counterparty: 'MS',
  };
  const { position: p11 } = await createPosition(sql, { params: fx2 });
  await FLOW_REGISTRY.ROLL.run(sql, p11.id, {
    fromValueDate: '2026-08-04', toValueDate: '2026-11-04',
    fromRate: 152.30, toRate: 151.85,
  });

  const fx3: FxParams = {
    product: 'FX', pair: 'GBP/USD', baseCurrency: 'GBP', quoteCurrency: 'USD',
    kind: 'SWAP', valueDate: '2026-05-08', notionalBase: 15_000_000, rate: 1.2615,
    farValueDate: '2026-08-08', farRate: 1.2588,
    counterparty: 'BARC',
  };
  const { position: p12 } = await createPosition(sql, { params: fx3 });
  await FLOW_REGISTRY.TERMINATION.run(sql, p12.id, {
    terminationDate: '2026-06-12', settlementAmount: 42_500, currency: 'USD',
  });

  console.log('[seed] inserted 12 positions across 4 products with lifecycle events');
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
