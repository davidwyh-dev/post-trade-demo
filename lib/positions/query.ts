import type { Sql } from 'postgres';
import type { Position, Event, ProductType } from '@/lib/db/schema';
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
