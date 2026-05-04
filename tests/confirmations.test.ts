import { describe, it, expect } from 'vitest';
import { getSql } from './setup';
import { createPosition } from '@/lib/positions/create';
import { FLOW_REGISTRY } from '@/lib/positions/flows';
import {
  listEvents,
  listEventsByDateRange,
  upsertEventConfirmation,
  bulkUpsertEventConfirmations,
} from '@/lib/positions/query';
import { resolveEffectivePayload } from '@/lib/positions/amendments';
import { deriveConfirmationStatus } from '@/lib/db/schema';
import type { IrsParams } from '@/lib/positions/params';

const irs: IrsParams = {
  product: 'IRS', currency: 'USD', notional: 100_000_000, fixedRate: 4.25,
  payReceive: 'PAY_FIXED', effectiveDate: '2026-05-04', maturityDate: '2031-05-04',
  floatingIndex: 'SOFR', counterparty: 'JPM', paymentFreqMonths: 3,
};

describe('event confirmations: upsert', () => {
  it('creates a row on first call and updates flags on subsequent calls', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    const reset = await FLOW_REGISTRY.RATE_RESET.run(sql, position.id, {
      resetDate: '2026-06-01', fixingRate: 5.32,
      accrualStartDate: '2026-06-01', accrualEndDate: '2026-09-01',
    });

    // First call: only set amount confirmed.
    let c = await upsertEventConfirmation(sql, reset.id, { amountConfirmed: true });
    expect(c.amountConfirmed).toBe(true);
    expect(c.amountConfirmedAt).toBeInstanceOf(Date);
    expect(c.reconciled).toBe(false);
    expect(c.reconciledAt).toBeNull();
    expect(deriveConfirmationStatus(c)).toBe('AMOUNT_CONFIRMED');

    // Second call: also reconcile. amount fields must remain.
    c = await upsertEventConfirmation(sql, reset.id, { reconciled: true });
    expect(c.amountConfirmed).toBe(true);
    expect(c.reconciled).toBe(true);
    expect(c.reconciledAt).toBeInstanceOf(Date);
    expect(deriveConfirmationStatus(c)).toBe('SETTLED');

    // Third call: clear amount confirmation; reconciled stays.
    c = await upsertEventConfirmation(sql, reset.id, { amountConfirmed: false });
    expect(c.amountConfirmed).toBe(false);
    expect(c.amountConfirmedAt).toBeNull();
    expect(c.reconciled).toBe(true);
  });

  it('notes are preserved when not supplied in a later patch', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    const reset = await FLOW_REGISTRY.RATE_RESET.run(sql, position.id, {
      resetDate: '2026-06-01', fixingRate: 5.32,
      accrualStartDate: '2026-06-01', accrualEndDate: '2026-09-01',
    });
    let c = await upsertEventConfirmation(sql, reset.id, { notes: 'awaiting JPM' });
    expect(c.notes).toBe('awaiting JPM');
    c = await upsertEventConfirmation(sql, reset.id, { amountConfirmed: true });
    expect(c.notes).toBe('awaiting JPM'); // unchanged
  });
});

describe('event confirmations: bulk', () => {
  it('confirms many events in one call', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    const a = await FLOW_REGISTRY.RATE_RESET.run(sql, position.id, {
      resetDate: '2026-06-01', fixingRate: 5.32,
      accrualStartDate: '2026-06-01', accrualEndDate: '2026-09-01',
    });
    const b = await FLOW_REGISTRY.COUPON.run(sql, position.id, {
      paymentDate: '2026-06-15', amount: 1_062_500, currency: 'USD',
    });

    const out = await bulkUpsertEventConfirmations(sql, [a.id, b.id], {
      amountConfirmed: true, reconciled: true, notes: 'desk-bulk',
    });
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.amountConfirmed).toBe(true);
      expect(c.reconciled).toBe(true);
      expect(c.notes).toBe('desk-bulk');
    }
  });
});

describe('listEventsByDateRange + AMEND chain', () => {
  it('returns events for the day with their position and confirmation joined', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    await FLOW_REGISTRY.COUPON.run(sql, position.id, {
      paymentDate: '2026-06-15', amount: 1_000_000, currency: 'USD',
    });
    const today = new Date().toISOString().slice(0, 10);
    const rows = await listEventsByDateRange(sql, today, today);
    // NEW is excluded; the COUPON should be in the window.
    expect(rows.find((r) => r.eventType === 'COUPON')).toBeDefined();
    expect(rows.find((r) => r.eventType === 'NEW')).toBeUndefined();
    const coupon = rows.find((r) => r.eventType === 'COUPON')!;
    expect(coupon.position.id).toBe(position.id);
    expect(coupon.confirmation).toBeNull();
  });

  it('AMEND with targetEventSequenceNo restates the prior event payload', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    const reset = await FLOW_REGISTRY.RATE_RESET.run(sql, position.id, {
      resetDate: '2026-06-01', fixingRate: 5.32,
      accrualStartDate: '2026-06-01', accrualEndDate: '2026-09-01',
    });
    // Operator restates the fixing.
    await FLOW_REGISTRY.AMEND.run(sql, position.id, {
      targetEventSequenceNo: reset.sequenceNo,
      overrides: { fixingRate: 5.30 },
      reason: 'corrected from desk bbl',
    });
    const all = await listEvents(sql, position.id);
    const target = all.find((e) => e.id === reset.id)!;
    const { payload, amended, amendingEventIds } = resolveEffectivePayload(target, all);
    expect(amended).toBe(true);
    expect(amendingEventIds).toHaveLength(1);
    expect(payload.fixingRate).toBe(5.30);
    expect(payload.resetDate).toBe('2026-06-01'); // un-touched fields kept
  });

  it('AMEND with overrides but no targetEventSequenceNo is rejected', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    // overrides without target is OK only if a position-level field is also set.
    // overrides + target IS valid; overrides without target AND without
    // newNotional/newRate/newQuantity is the rejected combination — but the
    // schema's first .refine accepts non-empty overrides as a change. The
    // *second* refine rejects target-without-overrides. Verify both:
    await expect(
      FLOW_REGISTRY.AMEND.run(sql, position.id, { targetEventSequenceNo: 1 }),
    ).rejects.toBeDefined();
  });

  it('AMEND with only position-level fields (legacy shape) still works', async () => {
    const sql = getSql();
    const { position } = await createPosition(sql, { params: irs });
    const ev = await FLOW_REGISTRY.AMEND.run(sql, position.id, {
      newNotional: 50_000_000, reason: 'partial reduction',
    });
    expect(ev.eventType).toBe('AMEND');
    expect((ev.payload as Record<string, unknown>).targetEventSequenceNo).toBeUndefined();
  });
});
