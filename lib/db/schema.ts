import {
  pgTable,
  bigserial,
  bigint,
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

export type Counterparty = typeof counterparties.$inferSelect;
export type Position     = typeof positions.$inferSelect;
export type Event        = typeof events.$inferSelect;
export type ProductType  = (typeof productType.enumValues)[number];
export type EventType    = (typeof eventType.enumValues)[number];
export type PositionStatus = (typeof positionStatus.enumValues)[number];
