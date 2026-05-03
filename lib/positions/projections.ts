import type { Position, Event } from '@/lib/db/schema';

// Synthetic, never-persisted events derived from a position's params.
// Rendered in the Event DAG when the user toggles "Projected" on.
export type ProjectedEvent = {
  id: string;                                                           // 'proj-1', 'proj-2', ...
  eventType: 'RATE_RESET' | 'COUPON' | 'EXPIRY' | 'ROLL';
  effectiveAt: string;                                                  // ISO datetime UTC midnight
  payload: Record<string, unknown>;
};

// Naive month addition (no business-day adjustment, no day-count rules).
// Day-of-month rollover (e.g. Aug 31 + 6mo) is acceptable for a demo.
function addMonthsUTC(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function effectiveAtUTC(iso: string): string {
  return `${iso}T00:00:00.000Z`;
}

function dateToISO(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

const MAX_STEPS = 200;

export function projectFutureEvents(
  position: Position,
  events: Event[],
  now: Date,
): ProjectedEvent[] {
  if (position.status !== 'OPEN') return [];

  const params = position.params as Record<string, unknown>;
  const todayIso = dateToISO(now);
  const out: ProjectedEvent[] = [];
  let counter = 1;
  const nextId = () => `proj-${counter++}`;

  switch (position.product) {
    case 'IRS': {
      const effectiveDate = params.effectiveDate as string;
      const maturityDate  = params.maturityDate as string;
      const freq          = params.paymentFreqMonths as number;
      const floatingIndex = params.floatingIndex as string;

      // Anchor cadence on the latest existing RATE_RESET if there is one,
      // otherwise on effectiveDate. This way irregular seed data still
      // produces a coherent forward chain.
      const latestResetStart = events
        .filter((e) => e.eventType === 'RATE_RESET')
        .map((e) => {
          const p = e.payload as Record<string, unknown>;
          return (p.resetDate ?? p.accrualStartDate) as string | undefined;
        })
        .filter((s): s is string => typeof s === 'string')
        .sort()
        .at(-1);

      const hasExistingReset = latestResetStart !== undefined;
      const anchor = latestResetStart ?? effectiveDate;
      const firstStep = hasExistingReset ? 1 : 0;

      for (let i = firstStep; i < MAX_STEPS; i++) {
        const start = addMonthsUTC(anchor, freq * i);
        if (start >= maturityDate) break;
        if (start <= todayIso) continue;
        const end = addMonthsUTC(anchor, freq * (i + 1));
        out.push({
          id: nextId(),
          eventType: 'RATE_RESET',
          effectiveAt: effectiveAtUTC(start),
          payload: {
            resetDate: start,
            accrualStartDate: start,
            accrualEndDate: end,
            floatingIndex,
            projected: true,
          },
        });
      }

      const hasExpiry = events.some((e) => e.eventType === 'EXPIRY');
      if (!hasExpiry && maturityDate > todayIso) {
        out.push({
          id: nextId(),
          eventType: 'EXPIRY',
          effectiveAt: effectiveAtUTC(maturityDate),
          payload: { expiryDate: maturityDate, projected: true },
        });
      }
      break;
    }

    case 'FUTURE': {
      const expiryDate = params.expiryDate as string;
      const closed = events.some((e) =>
        e.eventType === 'EXPIRY' || e.eventType === 'TERMINATION' || e.eventType === 'CANCEL',
      );
      if (!closed && expiryDate > todayIso) {
        out.push({
          id: nextId(),
          eventType: 'EXPIRY',
          effectiveAt: effectiveAtUTC(expiryDate),
          payload: { expiryDate, projected: true },
        });
      }
      break;
    }

    case 'TREASURY': {
      const maturityDate = params.maturityDate as string;
      const coupon       = params.coupon as number;
      const initialFace  = params.initialFaceAmount as number;
      const currency     = params.currency as string;

      const latestCouponDate = events
        .filter((e) => e.eventType === 'COUPON')
        .map((e) => (e.payload as Record<string, unknown>).paymentDate as string | undefined)
        .filter((s): s is string => typeof s === 'string')
        .sort()
        .at(-1);

      const anchor = latestCouponDate ?? dateToISO(position.openedAt);
      const amount = (initialFace * (coupon / 100)) / 2;
      const FREQ = 6;

      for (let i = 1; i < MAX_STEPS; i++) {
        const date = addMonthsUTC(anchor, FREQ * i);
        if (date > maturityDate) break;
        if (date <= todayIso) continue;
        out.push({
          id: nextId(),
          eventType: 'COUPON',
          effectiveAt: effectiveAtUTC(date),
          payload: { paymentDate: date, amount, currency, projected: true },
        });
      }

      const hasExpiry = events.some((e) => e.eventType === 'EXPIRY');
      if (!hasExpiry && maturityDate > todayIso) {
        out.push({
          id: nextId(),
          eventType: 'EXPIRY',
          effectiveAt: effectiveAtUTC(maturityDate),
          payload: { expiryDate: maturityDate, projected: true },
        });
      }
      break;
    }

    case 'FX': {
      const kind         = params.kind as string;
      const valueDate    = params.valueDate as string;
      const farValueDate = params.farValueDate as string | undefined;

      if (kind === 'SWAP' && farValueDate) {
        if (valueDate > todayIso) {
          out.push({
            id: nextId(),
            eventType: 'ROLL',
            effectiveAt: effectiveAtUTC(valueDate),
            payload: { fromValueDate: valueDate, toValueDate: farValueDate, projected: true },
          });
        }
        if (farValueDate > todayIso) {
          out.push({
            id: nextId(),
            eventType: 'EXPIRY',
            effectiveAt: effectiveAtUTC(farValueDate),
            payload: { expiryDate: farValueDate, projected: true },
          });
        }
      } else {
        if (valueDate > todayIso) {
          out.push({
            id: nextId(),
            eventType: 'EXPIRY',
            effectiveAt: effectiveAtUTC(valueDate),
            payload: { expiryDate: valueDate, projected: true },
          });
        }
      }
      break;
    }
  }

  return out.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
}
