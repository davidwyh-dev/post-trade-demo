import type { Sql } from 'postgres';
import type { EventType } from '@/lib/db/schema';

export type AppendedEvent = {
  id: number;
  positionId: number;
  sequenceNo: number;
  eventType: EventType;
  parentEventId: number | null;
  payload: Record<string, unknown>;
  externalId: string | null;
  effectiveAt: Date;
  createdAt: Date;
  /** True when this event already existed for the given external_id and was returned as-is. */
  replayed: boolean;
  /** Writer WAL LSN immediately after commit. Null if not exposed by the cluster. */
  lsn: string | null;
};

export type AppendInput = {
  positionId: number;
  eventType: EventType;
  payload: Record<string, unknown>;
  externalId?: string;
  effectiveAt?: Date;
  /**
   * For branching events (PARTIAL_UNWIND, NOVATION). When omitted, the new
   * event's parent_event_id is set to the most recent event on the position
   * (the linear case).
   */
  parentEventId?: number;
};

const MAX_RETRIES = 3;

/**
 * Append an event to a position. Computes the next sequence_no, sets
 * parent_event_id, and writes inside a SERIALIZABLE transaction with
 * retry on serialization failure or a sequence-uniqueness collision
 * (concurrent appender raced us).
 *
 * Idempotency: if external_id is already present, returns the existing
 * event with replayed=true. Safe to retry across transport errors.
 */
export async function appendEvent(sql: Sql, input: AppendInput): Promise<AppendedEvent> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await runOnce(sql, input);
    } catch (err) {
      if (input.externalId && isUniqueViolation(err, 'events_external_id_key')) {
        const existing = await loadByExternalId(sql, input.externalId);
        if (existing) return existing;
      }
      // Concurrent appender beat us to (position_id, sequence_no) — retry.
      if (isUniqueViolation(err, 'events_position_seq') && attempt < MAX_RETRIES - 1) {
        lastErr = err;
        continue;
      }
      if (isSerializationFailure(err) && attempt < MAX_RETRIES - 1) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('appendEvent: exhausted retries');
}

async function runOnce(sql: Sql, input: AppendInput): Promise<AppendedEvent> {
  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;

    const [{ next_seq, latest_id }] = await tx<{ next_seq: number; latest_id: number | null }[]>`
      SELECT
        COALESCE(MAX(sequence_no), 0) + 1 AS next_seq,
        (SELECT id FROM events WHERE position_id = ${input.positionId} ORDER BY sequence_no DESC LIMIT 1) AS latest_id
      FROM events
      WHERE position_id = ${input.positionId}
    `;

    const parentId = input.parentEventId ?? latest_id;

    const [row] = await tx<{
      id: number;
      position_id: number;
      sequence_no: number;
      event_type: string;
      parent_event_id: number | null;
      payload: Record<string, unknown>;
      external_id: string | null;
      effective_at: Date;
      created_at: Date;
    }[]>`
      INSERT INTO events (position_id, sequence_no, event_type, parent_event_id, payload, external_id, effective_at)
      VALUES (
        ${input.positionId},
        ${next_seq},
        ${input.eventType}::event_type,
        ${parentId},
        ${tx.json(input.payload as never)},
        ${input.externalId ?? null},
        ${input.effectiveAt ?? new Date()}
      )
      RETURNING id, position_id, sequence_no, event_type, parent_event_id, payload, external_id, effective_at, created_at
    `;

    let lsn: string | null = null;
    try {
      const [lsnRow] = await tx<{ lsn: string }[]>`SELECT pg_current_wal_lsn()::text AS lsn`;
      lsn = lsnRow?.lsn ?? null;
    } catch { /* ignore */ }

    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      sequenceNo: Number(row.sequence_no),
      eventType: row.event_type as EventType,
      parentEventId: row.parent_event_id !== null ? Number(row.parent_event_id) : null,
      payload: row.payload,
      externalId: row.external_id,
      effectiveAt: row.effective_at,
      createdAt: row.created_at,
      replayed: false,
      lsn,
    };
  }) as unknown as AppendedEvent;
}

async function loadByExternalId(sql: Sql, externalId: string): Promise<AppendedEvent | null> {
  const rows = await sql<{
    id: number;
    position_id: number;
    sequence_no: number;
    event_type: string;
    parent_event_id: number | null;
    payload: Record<string, unknown>;
    external_id: string;
    effective_at: Date;
    created_at: Date;
  }[]>`
    SELECT id, position_id, sequence_no, event_type, parent_event_id, payload, external_id, effective_at, created_at
    FROM events WHERE external_id = ${externalId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    positionId: Number(r.position_id),
    sequenceNo: Number(r.sequence_no),
    eventType: r.event_type as EventType,
    parentEventId: r.parent_event_id !== null ? Number(r.parent_event_id) : null,
    payload: r.payload,
    externalId: r.external_id,
    effectiveAt: r.effective_at,
    createdAt: r.created_at,
    replayed: true,
    lsn: null,
  };
}

function isSerializationFailure(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '40001';
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  if (e?.code !== '23505') return false;
  if (!constraint) return true;
  return e.constraint_name === constraint;
}
