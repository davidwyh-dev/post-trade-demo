import {
  pgTable,
  bigserial,
  bigint,
  boolean,
  integer,
  text,
  char,
  timestamp,
  pgEnum,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const productType    = pgEnum('product_type',    ['IRS','FUTURE','TREASURY','FX']);
export const positionStatus = pgEnum('position_status', ['OPEN','CLOSED','TERMINATED']);
export const eventType      = pgEnum('event_type', [
  'NEW','AMEND','RATE_RESET','COUPON','NOVATION',
  'TERMINATION','ROLL','EXPIRY','CANCEL','PARTIAL_UNWIND',
]);

export const counterparties = pgTable('counterparties', {
  code:      text('code').primaryKey(),
  name:      text('name').notNull(),
  aliases:   text('aliases').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable(
  'positions',
  {
    id:          bigserial('id', { mode: 'number' }).primaryKey(),
    product:     productType('product').notNull(),
    positionKey: char('position_key', { length: 64 }).notNull(),
    params:      jsonb('params').notNull(),
    status:      positionStatus('status').notNull().default('OPEN'),
    openedAt:    timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt:    timestamp('closed_at', { withTimezone: true }),
    metadata:    jsonb('metadata').notNull().default({}),
  },
  (t) => [
    uniqueIndex('positions_key_unique').on(t.product, t.positionKey),
    index('positions_status').on(t.status),
  ],
);

export const events = pgTable(
  'events',
  {
    id:            bigserial('id', { mode: 'number' }).primaryKey(),
    positionId:    bigint('position_id', { mode: 'number' }).notNull().references(() => positions.id),
    sequenceNo:    integer('sequence_no').notNull(),
    eventType:     eventType('event_type').notNull(),
    parentEventId: bigint('parent_event_id', { mode: 'number' }).references((): AnyPgColumn => events.id),
    payload:       jsonb('payload').notNull(),
    externalId:    text('external_id').unique(),
    effectiveAt:   timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('events_position_seq').on(t.positionId, t.sequenceNo),
    index('events_position_created').on(t.positionId, t.createdAt),
  ],
);

// Operational confirmation state per event. Sibling to the append-only ledger;
// rows here ARE mutable. See drizzle/0002_event_confirmations.sql for schema.
export const eventConfirmations = pgTable('event_confirmations', {
  id:                  bigserial('id', { mode: 'number' }).primaryKey(),
  eventId:             bigint('event_id', { mode: 'number' }).notNull().unique().references(() => events.id),
  amountConfirmed:     boolean('amount_confirmed').notNull().default(false),
  amountConfirmedAt:   timestamp('amount_confirmed_at', { withTimezone: true }),
  reconciled:          boolean('reconciled').notNull().default(false),
  reconciledAt:        timestamp('reconciled_at', { withTimezone: true }),
  notes:               text('notes'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Derived status for an event from its (optional) confirmation row.
export type ConfirmationStatus = 'PENDING' | 'AMOUNT_CONFIRMED' | 'SETTLED';
export function deriveConfirmationStatus(c: { amountConfirmed: boolean; reconciled: boolean } | null | undefined): ConfirmationStatus {
  if (!c) return 'PENDING';
  if (c.reconciled && c.amountConfirmed) return 'SETTLED';
  if (c.amountConfirmed) return 'AMOUNT_CONFIRMED';
  return 'PENDING';
}

export type Counterparty = typeof counterparties.$inferSelect;
export type Position     = typeof positions.$inferSelect;
export type Event        = typeof events.$inferSelect;
export type EventConfirmation = typeof eventConfirmations.$inferSelect;
export type ProductType  = (typeof productType.enumValues)[number];
export type EventType    = (typeof eventType.enumValues)[number];
export type PositionStatus = (typeof positionStatus.enumValues)[number];
