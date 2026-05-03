import { describe, it, expect } from 'vitest';
import { getSql } from './setup';

// These tests lock the SQL surface: the demo's whole story is that the database
// itself enforces append-only and lifecycle invariants. If any of these stops
// throwing, the demo is silently broken.

async function insertOpenPosition(externalIdSuffix = '') {
  const sql = getSql();
  const [pos] = await sql<{ id: number }[]>`
    INSERT INTO positions (product, position_key, params)
    VALUES ('IRS', repeat('a', 64), '{"product":"IRS","notional":100}'::jsonb)
    RETURNING id
  `;
  await sql`
    INSERT INTO events (position_id, sequence_no, event_type, payload, external_id)
    VALUES (${pos.id}, 1, 'NEW', '{}'::jsonb, ${'new-' + pos.id + externalIdSuffix})
  `;
  return pos.id;
}

describe('append-only invariants', () => {
  it('rejects UPDATE on events', async () => {
    const sql = getSql();
    await insertOpenPosition();
    await expect(
      sql`UPDATE events SET payload = '{"hacked":true}'::jsonb WHERE sequence_no = 1`,
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE on events', async () => {
    const sql = getSql();
    await insertOpenPosition();
    await expect(sql`DELETE FROM events WHERE sequence_no = 1`).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE on positions', async () => {
    const sql = getSql();
    const id = await insertOpenPosition();
    await expect(sql`DELETE FROM positions WHERE id = ${id}`).rejects.toThrow(/append-only/i);
  });

  it('rejects UPDATE that touches an immutable position column', async () => {
    const sql = getSql();
    const id = await insertOpenPosition();
    await expect(
      sql`UPDATE positions SET params = '{"hacked":true}'::jsonb WHERE id = ${id}`,
    ).rejects.toThrow(/only status, closed_at, metadata/i);
  });

  it('allows UPDATE on positions.status (lifecycle terminal state)', async () => {
    const sql = getSql();
    const id = await insertOpenPosition();
    await sql`UPDATE positions SET status = 'TERMINATED', closed_at = now() WHERE id = ${id}`;
    const [row] = await sql<{ status: string }[]>`SELECT status FROM positions WHERE id = ${id}`;
    expect(row.status).toBe('TERMINATED');
  });
});

describe('lifecycle invariants', () => {
  it('rejects a non-NEW event with sequence_no = 1', async () => {
    const sql = getSql();
    const [pos] = await sql<{ id: number }[]>`
      INSERT INTO positions (product, position_key, params)
      VALUES ('IRS', repeat('b', 64), '{}'::jsonb)
      RETURNING id
    `;
    await expect(sql`
      INSERT INTO events (position_id, sequence_no, event_type, payload)
      VALUES (${pos.id}, 1, 'AMEND', '{}'::jsonb)
    `).rejects.toThrow(/first event of a position must be NEW/i);
  });

  it('rejects a NEW event with sequence_no > 1', async () => {
    const sql = getSql();
    const id = await insertOpenPosition();
    await expect(sql`
      INSERT INTO events (position_id, sequence_no, event_type, payload)
      VALUES (${id}, 2, 'NEW', '{}'::jsonb)
    `).rejects.toThrow(/NEW event must have sequence_no = 1/i);
  });

  it('rejects a sparse sequence (gaps in sequence_no)', async () => {
    const sql = getSql();
    const id = await insertOpenPosition();
    // Skip sequence_no = 2, jump to 3 — should fail at COMMIT via the deferred trigger.
    await expect(sql.begin(async (tx) => {
      await tx`
        INSERT INTO events (position_id, sequence_no, event_type, payload)
        VALUES (${id}, 3, 'AMEND', '{}'::jsonb)
      `;
    })).rejects.toThrow(/Sequence invariant/i);
  });

  it('enforces position_key uniqueness per product', async () => {
    const sql = getSql();
    await sql`
      INSERT INTO positions (product, position_key, params)
      VALUES ('IRS', repeat('c', 64), '{}'::jsonb)
    `;
    await expect(sql`
      INSERT INTO positions (product, position_key, params)
      VALUES ('IRS', repeat('c', 64), '{}'::jsonb)
    `).rejects.toThrow(/positions_key_unique/i);
  });

  it('allows the same position_key across different products', async () => {
    const sql = getSql();
    await sql`
      INSERT INTO positions (product, position_key, params)
      VALUES ('IRS', repeat('d', 64), '{}'::jsonb)
    `;
    await sql`
      INSERT INTO positions (product, position_key, params)
      VALUES ('FX', repeat('d', 64), '{}'::jsonb)
    `;
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM positions WHERE position_key = repeat('d', 64)
    `;
    expect(Number(count)).toBe(2);
  });
});
