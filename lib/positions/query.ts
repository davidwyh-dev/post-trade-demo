import type { Sql } from 'postgres';
import type { Position, Event, EventConfirmation, ProductType } from '@/lib/db/schema';
import { computeKey } from './key';
import { PositionParams } from './params';

export async function listPositions(sql: Sql): Promise<Position[]> {
  const rows = await sql<Position[]>`
    SELECT id, product, position_key AS "positionKey", params,
           status, opened_at AS "openedAt", closed_at AS "closedAt", metadata
    FROM positions
    ORDER BY opened_at DESC, id DESC
  `;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function getPosition(sql: Sql, id: number): Promise<Position | null> {
  const rows = await sql<Position[]>`
    SELECT id, product, position_key AS "positionKey", params,
           status, opened_at AS "openedAt", closed_at AS "closedAt", metadata
    FROM positions WHERE id = ${id}
  `;
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

export async function listEvents(sql: Sql, positionId: number): Promise<Event[]> {
  const rows = await sql<Event[]>`
    SELECT id, position_id AS "positionId", sequence_no AS "sequenceNo",
           event_type AS "eventType", parent_event_id AS "parentEventId",
           payload, external_id AS "externalId",
           effective_at AS "effectiveAt", created_at AS "createdAt"
    FROM events
    WHERE position_id = ${positionId}
    ORDER BY sequence_no
  `;
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    positionId: Number(r.positionId),
    parentEventId: r.parentEventId !== null ? Number(r.parentEventId) : null,
  }));
}

/**
 * Event row enriched with its parent position's product/params/status and
 * (if present) confirmation row. Drives the Confirmations page table and
 * summary; everything the UI needs in one round trip.
 */
export type EnrichedEvent = Event & {
  position: Position;
  confirmation: EventConfirmation | null;
};

/**
 * List events whose effective_at falls within [from, to] inclusive (date-only),
 * joined with position and confirmation. Excludes pure-bookkeeping NEW events
 * since they don't represent a confirmable cash flow or operational action.
 */
export async function listEventsByDateRange(
  sql: Sql,
  fromDate: string,   // YYYY-MM-DD
  toDate: string,     // YYYY-MM-DD inclusive
): Promise<EnrichedEvent[]> {
  const rows = await sql<Array<{
    e_id: number;
    e_position_id: number;
    e_sequence_no: number;
    e_event_type: string;
    e_parent_event_id: number | null;
    e_payload: Record<string, unknown>;
    e_external_id: string | null;
    e_effective_at: Date;
    e_created_at: Date;
    p_id: number;
    p_product: ProductType;
    p_position_key: string;
    p_params: Record<string, unknown>;
    p_status: string;
    p_opened_at: Date;
    p_closed_at: Date | null;
    p_metadata: Record<string, unknown>;
    c_id: number | null;
    c_amount_confirmed: boolean | null;
    c_amount_confirmed_at: Date | null;
    c_reconciled: boolean | null;
    c_reconciled_at: Date | null;
    c_notes: string | null;
    c_created_at: Date | null;
    c_updated_at: Date | null;
  }>>`
    SELECT
      e.id              AS e_id,
      e.position_id     AS e_position_id,
      e.sequence_no     AS e_sequence_no,
      e.event_type      AS e_event_type,
      e.parent_event_id AS e_parent_event_id,
      e.payload         AS e_payload,
      e.external_id     AS e_external_id,
      e.effective_at    AS e_effective_at,
      e.created_at      AS e_created_at,
      p.id              AS p_id,
      p.product         AS p_product,
      p.position_key    AS p_position_key,
      p.params          AS p_params,
      p.status          AS p_status,
      p.opened_at       AS p_opened_at,
      p.closed_at       AS p_closed_at,
      p.metadata        AS p_metadata,
      c.id                  AS c_id,
      c.amount_confirmed    AS c_amount_confirmed,
      c.amount_confirmed_at AS c_amount_confirmed_at,
      c.reconciled          AS c_reconciled,
      c.reconciled_at       AS c_reconciled_at,
      c.notes               AS c_notes,
      c.created_at          AS c_created_at,
      c.updated_at          AS c_updated_at
    FROM events e
    JOIN positions p ON p.id = e.position_id
    LEFT JOIN event_confirmations c ON c.event_id = e.id
    -- Compare in UTC so the filter matches the YYYY-MM-DD strings the UI ships
    -- (rest of the codebase uses Date.toISOString().slice(0,10), which is UTC).
    -- Otherwise the session timezone (e.g. America/New_York for embedded-pg)
    -- silently shifts the day boundary and drops events near midnight UTC.
    WHERE (e.effective_at AT TIME ZONE 'UTC')::date >= ${fromDate}::date
      AND (e.effective_at AT TIME ZONE 'UTC')::date <= ${toDate}::date
      AND e.event_type <> 'NEW'
    ORDER BY e.effective_at ASC, e.id ASC
  `;
  return rows.map((r) => ({
    id:            Number(r.e_id),
    positionId:    Number(r.e_position_id),
    sequenceNo:    Number(r.e_sequence_no),
    eventType:     r.e_event_type as Event['eventType'],
    parentEventId: r.e_parent_event_id !== null ? Number(r.e_parent_event_id) : null,
    payload:       r.e_payload,
    externalId:    r.e_external_id,
    effectiveAt:   r.e_effective_at,
    createdAt:     r.e_created_at,
    position: {
      id:          Number(r.p_id),
      product:     r.p_product,
      positionKey: r.p_position_key,
      params:      r.p_params,
      status:      r.p_status as Position['status'],
      openedAt:    r.p_opened_at,
      closedAt:    r.p_closed_at,
      metadata:    r.p_metadata,
    } as Position,
    confirmation: r.c_id === null ? null : {
      id:                Number(r.c_id),
      eventId:           Number(r.e_id),
      amountConfirmed:   r.c_amount_confirmed!,
      amountConfirmedAt: r.c_amount_confirmed_at,
      reconciled:        r.c_reconciled!,
      reconciledAt:      r.c_reconciled_at,
      notes:             r.c_notes,
      createdAt:         r.c_created_at!,
      updatedAt:         r.c_updated_at!,
    },
  }));
}

export type ConfirmationUpdate = {
  amountConfirmed?: boolean;
  reconciled?: boolean;
  notes?: string | null;
};

/**
 * Upsert a confirmation row. `undefined` fields in `patch` keep their existing
 * values (COALESCE on UPDATE; column default on first INSERT). Setting a flag
 * to true stamps its _at timestamp; setting it to false clears the timestamp.
 */
export async function upsertEventConfirmation(
  sql: Sql,
  eventId: number,
  patch: ConfirmationUpdate,
): Promise<EventConfirmation> {
  const now = new Date();
  // Pass undefined as null at the SQL layer; COALESCE on UPDATE keeps the prior
  // value when the patch field wasn't supplied.
  const amt = patch.amountConfirmed ?? null;
  const amtAt = patch.amountConfirmed === undefined
    ? null
    : (patch.amountConfirmed ? now : null);
  const rec = patch.reconciled ?? null;
  const recAt = patch.reconciled === undefined
    ? null
    : (patch.reconciled ? now : null);
  const notes = patch.notes === undefined ? null : patch.notes;
  const notesProvided = patch.notes !== undefined;

  const rows = await sql<Array<{
    id: number; event_id: number;
    amount_confirmed: boolean; amount_confirmed_at: Date | null;
    reconciled: boolean; reconciled_at: Date | null;
    notes: string | null; created_at: Date; updated_at: Date;
  }>>`
    INSERT INTO event_confirmations
      (event_id, amount_confirmed, amount_confirmed_at, reconciled, reconciled_at, notes)
    VALUES (
      ${eventId},
      COALESCE(${amt}, FALSE),
      ${amtAt},
      COALESCE(${rec}, FALSE),
      ${recAt},
      ${notes}
    )
    ON CONFLICT (event_id) DO UPDATE SET
      amount_confirmed    = COALESCE(${amt}, event_confirmations.amount_confirmed),
      amount_confirmed_at = CASE
                              WHEN ${amt}::boolean IS NULL THEN event_confirmations.amount_confirmed_at
                              WHEN ${amt}::boolean = TRUE  THEN ${amtAt}
                              ELSE NULL
                            END,
      reconciled          = COALESCE(${rec}, event_confirmations.reconciled),
      reconciled_at       = CASE
                              WHEN ${rec}::boolean IS NULL THEN event_confirmations.reconciled_at
                              WHEN ${rec}::boolean = TRUE  THEN ${recAt}
                              ELSE NULL
                            END,
      notes               = CASE WHEN ${notesProvided} THEN ${notes} ELSE event_confirmations.notes END
    RETURNING id, event_id, amount_confirmed, amount_confirmed_at,
              reconciled, reconciled_at, notes, created_at, updated_at
  `;
  const r = rows[0];
  return {
    id: Number(r.id),
    eventId: Number(r.event_id),
    amountConfirmed: r.amount_confirmed,
    amountConfirmedAt: r.amount_confirmed_at,
    reconciled: r.reconciled,
    reconciledAt: r.reconciled_at,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Bulk upsert: set both flags + (optionally) notes on every event in `eventIds`.
 * One round trip via UNNEST. Used by the Events Summary "Bulk confirm" action.
 */
export async function bulkUpsertEventConfirmations(
  sql: Sql,
  eventIds: number[],
  patch: { amountConfirmed: boolean; reconciled: boolean; notes?: string | null },
): Promise<EventConfirmation[]> {
  if (eventIds.length === 0) return [];
  const now = new Date();
  const amtAt = patch.amountConfirmed ? now : null;
  const recAt = patch.reconciled ? now : null;
  const rows = await sql<Array<{
    id: number; event_id: number;
    amount_confirmed: boolean; amount_confirmed_at: Date | null;
    reconciled: boolean; reconciled_at: Date | null;
    notes: string | null; created_at: Date; updated_at: Date;
  }>>`
    INSERT INTO event_confirmations (event_id, amount_confirmed, amount_confirmed_at, reconciled, reconciled_at, notes)
    SELECT
      eid,
      ${patch.amountConfirmed},
      ${amtAt},
      ${patch.reconciled},
      ${recAt},
      ${patch.notes ?? null}
    FROM UNNEST(${eventIds}::bigint[]) AS t(eid)
    ON CONFLICT (event_id) DO UPDATE SET
      amount_confirmed    = EXCLUDED.amount_confirmed,
      amount_confirmed_at = EXCLUDED.amount_confirmed_at,
      reconciled          = EXCLUDED.reconciled,
      reconciled_at       = EXCLUDED.reconciled_at,
      notes               = COALESCE(EXCLUDED.notes, event_confirmations.notes)
    RETURNING id, event_id, amount_confirmed, amount_confirmed_at,
              reconciled, reconciled_at, notes, created_at, updated_at
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    eventId: Number(r.event_id),
    amountConfirmed: r.amount_confirmed,
    amountConfirmedAt: r.amount_confirmed_at,
    reconciled: r.reconciled,
    reconciledAt: r.reconciled_at,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export type ResolveResult = {
  positionId: number | null;
  product: ProductType;
  positionKey: string;
};

/**
 * Given parsed params, compute the key and look up whether a position
 * already exists. Used by the Trade CLI parse → match-or-create flow.
 */
export async function resolvePosition(sql: Sql, params: unknown): Promise<ResolveResult> {
  const parsed = PositionParams.parse(params);
  const key = computeKey(parsed);
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM positions
    WHERE product = ${parsed.product}::product_type AND position_key = ${key}
    LIMIT 1
  `;
  return {
    positionId: rows[0] ? Number(rows[0].id) : null,
    product: parsed.product,
    positionKey: key,
  };
}
