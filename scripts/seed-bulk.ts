// Bulk seed: ~2000 positions across IRS/FUTURE/TREASURY/FX with backdated
// open dates spread across the last 24 months and lifecycle events.
//
//   npm run seed:bulk                       # default 2000, deterministic
//   npm run seed:bulk -- --count=500
//   npm run seed:bulk -- --seed=42
//
// Wipes positions+events on each run. Curated 12 from _curated.ts come first
// for the happy-path demos; the rest are procedurally generated.

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getWriterSql } from '../lib/db/client';
import { createPosition } from '../lib/positions/create';
import { FLOW_REGISTRY } from '../lib/positions/flows';
import { CURATED_TICKETS } from './_curated';
import { mulberry32, generateTickets } from './_seed-generators';

config({ path: resolve(process.cwd(), '.env.local') });

type Args = { count: number; seed: number };

function parseArgs(argv: string[]): Args {
  let count = 2000;
  let seed = 1;
  for (const arg of argv) {
    if (arg.startsWith('--count=')) count = parseInt(arg.slice('--count='.length), 10);
    else if (arg.startsWith('--seed=')) seed = parseInt(arg.slice('--seed='.length), 10);
  }
  if (!Number.isFinite(count) || count < 0) throw new Error(`invalid --count: ${count}`);
  if (!Number.isFinite(seed)) throw new Error(`invalid --seed: ${seed}`);
  return { count, seed };
}

type BackdateRow = { id: number; opened_at: Date; closed_at: Date | null };

async function main() {
  const { count, seed } = parseArgs(process.argv.slice(2));
  const sql = getWriterSql();
  const t0 = Date.now();

  console.log(`[seed:bulk] count=${count} seed=${seed}`);
  console.log('[seed:bulk] wiping positions + events...');
  await sql.unsafe(`TRUNCATE TABLE events, positions RESTART IDENTITY CASCADE;`);

  const rng = mulberry32(seed);
  const today = new Date();
  const backdates: BackdateRow[] = [];

  // ---- 1. Insert the 12 curated demo positions ----
  console.log(`[seed:bulk] inserting ${CURATED_TICKETS.length} curated positions...`);
  for (let i = 0; i < CURATED_TICKETS.length; i++) {
    const ticket = CURATED_TICKETS[i];
    const { position } = await createPosition(sql, { params: ticket.params });
    for (const event of ticket.events) {
      await FLOW_REGISTRY[event.flow].run(sql, position.id, event.payload);
    }
    // Spread the curated 12 over the last ~18 months so they don't all land on today.
    const daysAgo = 30 + Math.floor(rng() * 510);
    backdates.push({
      id: position.id,
      opened_at: new Date(today.getTime() - daysAgo * 86_400_000),
      closed_at: null,
    });
  }

  // ---- 2. Generate the rest ----
  const remaining = Math.max(0, count - CURATED_TICKETS.length);
  if (remaining > 0) {
    console.log(`[seed:bulk] generating ${remaining} additional positions...`);
    const tickets = generateTickets(remaining, rng, today);

    let processed = 0;
    let skipped = 0;
    for (const ticket of tickets) {
      try {
        const { position, matched } = await createPosition(sql, {
          params: ticket.params,
          effectiveAt: ticket.openedAt,
        });
        if (matched) {
          // Duplicate position key (random collision). Skip — keeps the seed
          // self-correcting without needing to retry with new params.
          skipped++;
        } else {
          for (const event of ticket.events) {
            await FLOW_REGISTRY[event.flow].run(sql, position.id, event.payload);
          }
          backdates.push({
            id: position.id,
            opened_at: ticket.openedAt,
            closed_at: ticket.closedAt ?? null,
          });
        }
      } catch (err) {
        console.warn(`[seed:bulk]   skip on error: ${(err as Error).message}`);
        skipped++;
      }
      processed++;
      if (processed % 100 === 0) {
        console.log(`[seed:bulk]   ${processed}/${remaining} (${skipped} skipped)`);
      }
    }
  }

  // ---- 3. Backdate opened_at + closed_at in one batch ----
  // The positions_immutable_cols trigger normally rejects updates to opened_at.
  // We disable it briefly here, run a single UPDATE driven by a temp table,
  // then re-enable in a try/finally so a failure can't leave the trigger off.
  console.log(`[seed:bulk] backdating opened_at/closed_at for ${backdates.length} positions...`);
  await sql.unsafe(`ALTER TABLE positions DISABLE TRIGGER positions_immutable_cols;`);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        CREATE TEMP TABLE _backdate (
          id bigint PRIMARY KEY,
          opened_at timestamptz NOT NULL,
          closed_at timestamptz
        ) ON COMMIT DROP;
      `);
      await tx`INSERT INTO _backdate ${tx(backdates, 'id', 'opened_at', 'closed_at')}`;
      await tx`
        UPDATE positions
        SET opened_at = b.opened_at,
            closed_at = b.closed_at
        FROM _backdate b
        WHERE positions.id = b.id
      `;
    });
  } finally {
    await sql.unsafe(`ALTER TABLE positions ENABLE TRIGGER positions_immutable_cols;`);
  }

  // ---- 4. Summary ----
  const byProduct = await sql<{ product: string; cnt: string; min: Date; max: Date }[]>`
    SELECT product::text, count(*)::text AS cnt,
           min(opened_at) AS min, max(opened_at) AS max
    FROM positions GROUP BY product ORDER BY product
  `;
  const byStatus = await sql<{ status: string; cnt: string }[]>`
    SELECT status::text, count(*)::text AS cnt
    FROM positions GROUP BY status ORDER BY status
  `;
  const [{ cnt: eventCnt }] = await sql<{ cnt: string }[]>`SELECT count(*)::text AS cnt FROM events`;
  const [{ min, max }] = await sql<{ min: Date; max: Date }[]>`
    SELECT min(opened_at) AS min, max(opened_at) AS max FROM positions
  `;

  const total = byProduct.reduce((acc, r) => acc + Number(r.cnt), 0);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[seed:bulk] inserted ${total} positions: ` +
    byProduct.map((r) => `${r.product}=${r.cnt}`).join(', '),
  );
  console.log(`[seed:bulk] status: ` + byStatus.map((r) => `${r.status}=${r.cnt}`).join(', '));
  console.log(`[seed:bulk] events: ${eventCnt}`);
  console.log(
    `[seed:bulk] open dates: ${min.toISOString().slice(0, 10)} to ${max.toISOString().slice(0, 10)}`,
  );
  console.log(`[seed:bulk] done in ${elapsed}s`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
