import type { Sql } from 'postgres';
import { PositionParams } from './params';
import { computeKey } from './key';
import type { ProductType, Position } from '@/lib/db/schema';

export type CreatePositionInput = {
  params: unknown;            // validated against PositionParams below
  externalId?: string;        // idempotency key for the NEW event
  effectiveAt?: Date;         // business time for the NEW event
};

export type CreatedPosition = {
  position: Position;
  newEventId: number;
  /** True when this position already existed (matched by key) and was returned as-is. */
  matched: boolean;
  lsn: string | null;
};

/**
 * Create a position and its first NEW event in one transaction.
 *
 * If a position with the same (product, position_key) already exists, it is
 * returned with matched=true. The NEW event is also idempotent on external_id.
 *
 * This is the only flow that creates positions — every other event type
 * appends to an existing position via appendEvent().
 */
export async function createPosition(sql: Sql, input: CreatePositionInput): Promise<CreatedPosition> {
  const parsed = PositionParams.parse(input.params);
  const key = computeKey(parsed);

  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;

    // Try to insert; on conflict (same product + key), return the existing row.
    const insertResult = await tx<{
      id: number; product: ProductType; position_key: string; params: unknown;
      status: string; opened_at: Date; closed_at: Date | null; metadata: unknown;
    }[]>`
      INSERT INTO positions (product, position_key, params)
      VALUES (${parsed.product}::product_type, ${key}, ${tx.json(parsed as never)})
      ON CONFLICT (product, position_key) DO NOTHING
      RETURNING id, product, position_key, params, status, opened_at, closed_at, metadata
    `;

    let positionRow: typeof insertResult[number];
    let matched = false;

    if (insertResult.length === 0) {
      // Position already existed — load it.
      matched = true;
      const existing = await tx<typeof insertResult>`
        SELECT id, product, position_key, params, status, opened_at, closed_at, metadata
        FROM positions WHERE product = ${parsed.product}::product_type AND position_key = ${key}
      `;
      if (existing.length === 0) {
        throw new Error('createPosition: insert returned 0 rows but lookup also failed');
      }
      positionRow = existing[0];
    } else {
      positionRow = insertResult[0];
    }

    // For a brand-new position, append the NEW event. For a matched position,
    // we don't append a second NEW (the trigger would reject it anyway).
    let newEventId: number;
    if (matched) {
      const [{ id }] = await tx<{ id: number }[]>`
        SELECT id FROM events
        WHERE position_id = ${positionRow.id} AND event_type = 'NEW'
        ORDER BY sequence_no LIMIT 1
      `;
      newEventId = Number(id);
    } else {
      const [{ id }] = await tx<{ id: number }[]>`
        INSERT INTO events (position_id, sequence_no, event_type, payload, external_id, effective_at)
        VALUES (
          ${positionRow.id},
          1,
          'NEW',
          '{}'::jsonb,
          ${input.externalId ?? null},
          ${input.effectiveAt ?? new Date()}
        )
        RETURNING id
      `;
      newEventId = Number(id);
    }

    let lsn: string | null = null;
    try {
      const [lsnRow] = await tx<{ lsn: string }[]>`SELECT pg_current_wal_lsn()::text AS lsn`;
      lsn = lsnRow?.lsn ?? null;
    } catch { /* ignore */ }

    return {
      position: {
        id: Number(positionRow.id),
        product: positionRow.product,
        positionKey: positionRow.position_key,
        params: positionRow.params,
        status: positionRow.status,
        openedAt: positionRow.opened_at,
        closedAt: positionRow.closed_at,
        metadata: positionRow.metadata,
      } as Position,
      newEventId,
      matched,
      lsn,
    };
  }) as unknown as CreatedPosition;
}
