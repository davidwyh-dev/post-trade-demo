import type { Event, Position } from '@/lib/db/schema';
import { resolveEffectivePayload } from './amendments';

/**
 * The cash-flow profile of an event after merging in any later AMEND overrides.
 *
 * direction:
 *   'INCOMING' — money is received by the fund
 *   'OUTGOING' — money is paid by the fund
 *   'NONE'     — event has no cash leg (NOVATION, ROLL, CANCEL, AMEND)
 *
 * absAmount is always non-negative; direction carries the sign. Currency may be
 * undefined for events that don't carry one explicitly (we fall back to the
 * position's primary currency where possible).
 *
 * The mapping below is MVP-grade — sign of the payload amount + product side.
 * Real settlement systems compute net per leg per accrual period; we don't.
 * Documented honestly so the summary panel can label totals as "indicative".
 */
export type CashFlow = {
  direction: 'INCOMING' | 'OUTGOING' | 'NONE';
  absAmount: number;
  currency: string | undefined;
  /** True when overrides from a later AMEND were applied. */
  amended: boolean;
};

export function deriveCashFlow(event: Event, position: Position, allEventsForPosition: readonly Event[]): CashFlow {
  const { payload, amended } = resolveEffectivePayload(event, allEventsForPosition);
  const params = position.params as Record<string, unknown>;

  switch (event.eventType) {
    case 'COUPON': {
      const amount = numOrNull(payload.amount);
      const ccy = strOrUndef(payload.currency) ?? strOrUndef(params.currency);
      if (amount === null) return { direction: 'NONE', absAmount: 0, currency: ccy, amended };
      // Sign convention on the payload: positive = received (INCOMING).
      // For PAY_FIXED IRS, the fixed leg is a cash outflow at coupon dates;
      // we lean on payload sign rather than re-deriving leg direction.
      return signedToCashFlow(amount, ccy, amended);
    }
    case 'TERMINATION': {
      const amount = numOrNull(payload.settlementAmount);
      const ccy = strOrUndef(payload.currency) ?? strOrUndef(params.currency);
      if (amount === null) return { direction: 'NONE', absAmount: 0, currency: ccy, amended };
      return signedToCashFlow(amount, ccy, amended);
    }
    case 'EXPIRY': {
      const amount = numOrNull(payload.finalSettlement);
      const ccy = strOrUndef(payload.finalSettlementCcy) ?? strOrUndef(params.currency);
      if (amount === null) return { direction: 'NONE', absAmount: 0, currency: ccy, amended };
      return signedToCashFlow(amount, ccy, amended);
    }
    case 'PARTIAL_UNWIND': {
      const amount = numOrNull(payload.settlementAmount);
      const ccy = strOrUndef(payload.currency) ?? strOrUndef(params.currency);
      if (amount === null) return { direction: 'NONE', absAmount: 0, currency: ccy, amended };
      return signedToCashFlow(amount, ccy, amended);
    }
    case 'RATE_RESET': {
      // No direct cash on a fixing — the cash flows on the next COUPON. Use the
      // notional × rate × (90/360) as an *indicative* accrual estimate, signed
      // by payReceive when the position is an IRS.
      const fixingRate = numOrNull(payload.fixingRate);
      const notional = numOrNull(params.notional);
      const ccy = strOrUndef(params.currency);
      if (fixingRate === null || notional === null) {
        return { direction: 'NONE', absAmount: 0, currency: ccy, amended };
      }
      const indicative = (notional * fixingRate * 0.25) / 100; // pct * 1q acc
      // PAY_FIXED receives floating → fixing-rate accrual is INCOMING.
      // RECV_FIXED pays floating → fixing-rate accrual is OUTGOING.
      const direction: CashFlow['direction'] =
        params.payReceive === 'PAY_FIXED' ? 'INCOMING' : 'OUTGOING';
      return { direction, absAmount: Math.abs(indicative), currency: ccy, amended };
    }
    default:
      return { direction: 'NONE', absAmount: 0, currency: strOrUndef(params.currency), amended };
  }
}

function signedToCashFlow(amount: number, currency: string | undefined, amended: boolean): CashFlow {
  if (amount === 0) return { direction: 'NONE', absAmount: 0, currency, amended };
  return {
    direction: amount >= 0 ? 'INCOMING' : 'OUTGOING',
    absAmount: Math.abs(amount),
    currency,
    amended,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Returns the rate index used by an event's parent position (e.g. 'SOFR' for
 * an IRS with floatingIndex=SOFR), if any. Used in the Events Summary's
 * "References" column.
 */
export function eventRateIndex(position: Position): string | undefined {
  const params = position.params as Record<string, unknown>;
  if (position.product === 'IRS') return strOrUndef(params.floatingIndex);
  return undefined;
}

/**
 * Returns the counterparty / account label per product, used to group totals
 * in the summary. Treasury and Future positions don't carry a counterparty on
 * the position (it lives on the event); we fall back to the account.
 */
export function eventCounterpartyOrAccount(position: Position): string {
  const p = position.params as Record<string, unknown>;
  switch (position.product) {
    case 'IRS': return String(p.counterparty ?? 'UNKNOWN');
    case 'FX':  return String(p.counterparty ?? 'UNKNOWN');
    case 'TREASURY': return `acct:${p.account ?? 'MAIN'}`;
    case 'FUTURE':   return `acct:${p.account ?? 'MAIN'}`;
    default: return 'UNKNOWN';
  }
}
