import { describe, it, expect } from 'vitest';
import { getSql } from './setup';
import { createPosition } from '@/lib/positions/create';
import { FLOW_REGISTRY } from '@/lib/positions/flows';
import { listEvents, getPosition } from '@/lib/positions/query';
import type { IrsParams, FxParams, FutureParams, TreasuryParams } from '@/lib/positions/params';

const irs: IrsParams = {
  product: 'IRS', currency: 'USD', notional: 100_000_000, fixedRate: 4.25,
  payReceive: 'PAY_FIXED', effectiveDate: '2026-05-04', maturityDate: '2031-05-04',
  floatingIndex: 'SOFR', counterparty: 'JPM', paymentFreqMonths: 3,
};

describe('createPosition', () => {
  it('creates a new position with a NEW event at sequence_no 1', async () => {
    const sql = getSql();
    const created = await createPosition(sql, { params: irs });
    expect(created.matched).toBe(false);
    expect(created.position.product).toBe('IRS');
    expect(created.position.status).toBe('OPEN');

    const events = await listEvents(sql, created.position.id);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('NEW');
    expect(events[0].sequenceNo).toBe(1);
    expect(events[0].parentEventId).toBeNull();
  });

  it('returns matched=true for the same key params', async () => {
    const sql = getSql();
    const a = await createPosition(sql, { params: irs });
    const b = await createPosition(sql, { params: { ...irs, notional: 200_000_000 } });  // notional not in key
    expect(b.matched).toBe(true);
    expect(b.position.id).toBe(a.position.id);

    // Still only one event on the position; no duplicate NEW.
    const events = await listEvents(sql, a.position.id);
    expect(events).toHaveLength(1);
  });

  it('different counterparty produces a new position', async () => {
    const sql = getSql();
    const a = await createPosition(sql, { params: irs });
    const b = await createPosition(sql, { params: { ...irs, counterparty: 'GS' } });
    expect(b.matched).toBe(false);
    expect(b.position.id).not.toBe(a.position.id);
  });
});

describe('event flows', () => {
  it('AMEND appends with sequence_no=2 and links to the NEW event', async () => {
    const sql = getSql();
    const { position, newEventId } = await createPosition(sql, { params: irs });
    const event = await FLOW_REGISTRY.AMEND.run(sql, position.id, {
      newNotional: 50_000_000,
      reason: 'partial reduction',
    });
    expect(event.sequenceNo).toBe(2);
    expect(event.parentEventId).toBe(newEventId);
  });

  it('TERMINATION flips status to TERMINATED', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    await FLOW_REGISTRY.TERMINATION.run(sql, position.id, {
      terminationDate: '2026-06-01',
      settlementAmount: 1_500_000,
      currency: 'USD',
    });
    const updated = await getPosition(sql, position.id);
    expect(updated?.status).toBe('TERMINATED');
    expect(updated?.closedAt).toBeInstanceOf(Date);
  });

  it('idempotent retry: same externalId returns the same event', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    const a = await FLOW_REGISTRY.RATE_RESET.run(sql, position.id, {
      externalId: 'reset-2026Q2',
      resetDate: '2026-06-01', fixingRate: 5.32,
      accrualStartDate: '2026-06-01', accrualEndDate: '2026-09-01',
    });
    const b = await FLOW_REGISTRY.RATE_RESET.run(sql, position.id, {
      externalId: 'reset-2026Q2',
      resetDate: '2026-06-01', fixingRate: 5.32,
      accrualStartDate: '2026-06-01', accrualEndDate: '2026-09-01',
    });
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    const events = await listEvents(sql, position.id);
    expect(events).toHaveLength(2);  // NEW + one RATE_RESET (no duplicate)
  });

  it('PARTIAL_UNWIND with explicit parentEventId branches the DAG', async () => {
    const sql = getSql();
    const { position, newEventId } = await createPosition(sql, { params: irs });
    // First, an AMEND on the linear chain (seq 2, parent=NEW).
    const amend = await FLOW_REGISTRY.AMEND.run(sql, position.id, { newNotional: 80_000_000 });
    // Now branch: PARTIAL_UNWIND off the original NEW (not off AMEND).
    const branch = await FLOW_REGISTRY.PARTIAL_UNWIND.run(sql, position.id, {
      unwoundAmount: 30_000_000, currency: 'USD',
      parentEventId: newEventId,
    });
    expect(amend.parentEventId).toBe(newEventId);
    expect(branch.parentEventId).toBe(newEventId);
    expect(branch.sequenceNo).toBe(3);
  });

  it('rejects an AMEND payload without any change field', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    // Zod 4 throws ZodError; we just assert that something rejects.
    await expect(FLOW_REGISTRY.AMEND.run(sql, position.id, { reason: 'no-op' })).rejects.toBeDefined();
    // And confirm the position still has only the NEW event (the failed AMEND was not appended).
    const { listEvents } = await import('@/lib/positions/query');
    const events = await listEvents(sql, position.id);
    expect(events).toHaveLength(1);
  });
});

describe('all four products end-to-end', () => {
  it('FX SPOT', async () => {
    const sql = getSql();
    const fx: FxParams = {
      product: 'FX', pair: 'EUR/USD', baseCurrency: 'EUR', quoteCurrency: 'USD',
      kind: 'SPOT', valueDate: '2026-05-06', notionalBase: 25_000_000, rate: 1.0875,
      counterparty: 'GS',
    };
    const { position } = await createPosition(sql, { params: fx });
    expect(position.product).toBe('FX');
  });

  it('Future', async () => {
    const sql = getSql();
    const f: FutureParams = {
      product: 'FUTURE', contractCode: 'FVH6', exchange: 'CBOT', account: 'MAIN',
      initialContracts: 100, expiryDate: '2026-03-20', multiplier: 1000, tickSize: 0.0078125,
    };
    const { position } = await createPosition(sql, { params: f });
    await FLOW_REGISTRY.EXPIRY.run(sql, position.id, {
      expiryDate: '2026-03-20', finalSettlement: 105.5, finalSettlementCcy: 'USD',
    });
    const updated = await getPosition(sql, position.id);
    expect(updated?.status).toBe('CLOSED');
  });

  it('Treasury', async () => {
    const sql = getSql();
    const t: TreasuryParams = {
      product: 'TREASURY', isin: 'US912828YY08', issuer: 'US Treasury', currency: 'USD',
      coupon: 4.0, maturityDate: '2030-08-15', side: 'LONG', account: 'MAIN',
      initialFaceAmount: 10_000_000,
    };
    const { position } = await createPosition(sql, { params: t });
    await FLOW_REGISTRY.COUPON.run(sql, position.id, {
      paymentDate: '2026-08-15', amount: 200_000, currency: 'USD',
    });
    const events = await listEvents(sql, position.id);
    expect(events).toHaveLength(2);
    expect(events[1].eventType).toBe('COUPON');
  });
});
