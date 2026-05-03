import type { Sql } from 'postgres';
import { z } from 'zod';
import { appendEvent, type AppendedEvent } from '../append';
import type { EventType } from '@/lib/db/schema';

// Each flow is { schema, run }. The schema validates the request body's
// `payload` field plus the optional idempotency key. `run` calls appendEvent
// with the right event type. Status/closed_at side-effects (e.g. on
// TERMINATION) are applied here too.

const isoDate  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const idem = {
  externalId: z.string().optional(),
  effectiveAt: z.string().datetime().optional(),
};

function effective(input: { effectiveAt?: string }): Date | undefined {
  return input.effectiveAt ? new Date(input.effectiveAt) : undefined;
}

const AmendPayload = z.object({
  ...idem,
  newNotional:  z.number().positive().optional(),
  newRate:      z.number().optional(),
  newQuantity:  z.number().int().optional(),
  reason:       z.string().optional(),
}).refine(
  (v) => v.newNotional !== undefined || v.newRate !== undefined || v.newQuantity !== undefined,
  { message: 'AMEND requires at least one of newNotional, newRate, newQuantity' },
);

const RateResetPayload = z.object({
  ...idem,
  resetDate:         isoDate,
  fixingRate:        z.number(),
  accrualStartDate:  isoDate,
  accrualEndDate:    isoDate,
});

const CouponPayload = z.object({
  ...idem,
  paymentDate: isoDate,
  amount:      z.number(),
  currency:    z.string().length(3),
});

const NovationPayload = z.object({
  ...idem,
  fromCounterparty: z.string().min(1),
  toCounterparty:   z.string().min(1),
  novationDate:     isoDate,
});

const TerminationPayload = z.object({
  ...idem,
  terminationDate:  isoDate,
  settlementAmount: z.number().optional(),
  currency:         z.string().length(3).optional(),
});

const RollPayload = z.object({
  ...idem,
  fromValueDate: isoDate,
  toValueDate:   isoDate,
  fromRate:      z.number().positive().optional(),
  toRate:        z.number().positive().optional(),
});

const ExpiryPayload = z.object({
  ...idem,
  expiryDate:        isoDate,
  finalSettlement:   z.number().optional(),
  finalSettlementCcy: z.string().length(3).optional(),
});

const CancelPayload = z.object({
  ...idem,
  reason: z.string().min(1),
});

const PartialUnwindPayload = z.object({
  ...idem,
  unwoundAmount:    z.number().positive(),
  currency:         z.string().length(3),
  settlementAmount: z.number().optional(),
  /** Optional: link back to the prior event this branch forks from. */
  parentEventId:    z.number().int().positive().optional(),
});

type FlowResult = AppendedEvent;

export const FLOW_REGISTRY = {
  AMEND: {
    schema: AmendPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = AmendPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      return appendEvent(sql, {
        positionId, eventType: 'AMEND', payload, externalId, effectiveAt: effective(v),
      });
    },
  },
  RATE_RESET: {
    schema: RateResetPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = RateResetPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      return appendEvent(sql, {
        positionId, eventType: 'RATE_RESET', payload, externalId, effectiveAt: effective(v),
      });
    },
  },
  COUPON: {
    schema: CouponPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = CouponPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      return appendEvent(sql, {
        positionId, eventType: 'COUPON', payload, externalId, effectiveAt: effective(v),
      });
    },
  },
  NOVATION: {
    schema: NovationPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = NovationPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      return appendEvent(sql, {
        positionId, eventType: 'NOVATION', payload, externalId, effectiveAt: effective(v),
      });
    },
  },
  TERMINATION: {
    schema: TerminationPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = TerminationPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      const event = await appendEvent(sql, {
        positionId, eventType: 'TERMINATION', payload, externalId, effectiveAt: effective(v),
      });
      // Side effect: flip position to TERMINATED. The trigger allows this.
      if (!event.replayed) {
        await sql`UPDATE positions SET status = 'TERMINATED', closed_at = now() WHERE id = ${positionId} AND status = 'OPEN'`;
      }
      return event;
    },
  },
  ROLL: {
    schema: RollPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = RollPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      return appendEvent(sql, {
        positionId, eventType: 'ROLL', payload, externalId, effectiveAt: effective(v),
      });
    },
  },
  EXPIRY: {
    schema: ExpiryPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = ExpiryPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      const event = await appendEvent(sql, {
        positionId, eventType: 'EXPIRY', payload, externalId, effectiveAt: effective(v),
      });
      if (!event.replayed) {
        await sql`UPDATE positions SET status = 'CLOSED', closed_at = now() WHERE id = ${positionId} AND status = 'OPEN'`;
      }
      return event;
    },
  },
  CANCEL: {
    schema: CancelPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = CancelPayload.parse(p);
      const { externalId, effectiveAt: _e, ...payload } = v;
      const event = await appendEvent(sql, {
        positionId, eventType: 'CANCEL', payload, externalId, effectiveAt: effective(v),
      });
      if (!event.replayed) {
        await sql`UPDATE positions SET status = 'CLOSED', closed_at = now() WHERE id = ${positionId} AND status = 'OPEN'`;
      }
      return event;
    },
  },
  PARTIAL_UNWIND: {
    schema: PartialUnwindPayload,
    run: async (sql: Sql, positionId: number, p: unknown): Promise<FlowResult> => {
      const v = PartialUnwindPayload.parse(p);
      const { externalId, effectiveAt: _e, parentEventId, ...payload } = v;
      return appendEvent(sql, {
        positionId, eventType: 'PARTIAL_UNWIND', payload, externalId,
        effectiveAt: effective(v), parentEventId,
      });
    },
  },
} as const satisfies Record<Exclude<EventType, 'NEW'>, {
  schema: z.ZodTypeAny;
  run: (sql: Sql, positionId: number, p: unknown) => Promise<FlowResult>;
}>;

export type FlowName = keyof typeof FLOW_REGISTRY;
export const FLOW_NAMES = Object.keys(FLOW_REGISTRY) as FlowName[];
