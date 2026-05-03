// Idempotent demo seed: wipes positions+events and re-inserts the 12
// hand-curated positions from _curated.ts with their lifecycle events.
// Counterparties are preserved (they were inserted by drizzle/0001_seed_counterparties.sql).
//
//   npm run seed              # uses DATABASE_URL from .env.local
//   npm run seed:bulk         # the same 12 + ~1988 generated, backdated up to 2y
//
// Safe to run repeatedly; the TRUNCATE bypasses append-only triggers.

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getWriterSql } from '../lib/db/client';
import { createPosition } from '../lib/positions/create';
import { FLOW_REGISTRY } from '../lib/positions/flows';
import { CURATED_TICKETS } from './_curated';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const sql = getWriterSql();

  console.log('[seed] wiping positions + events...');
  await sql.unsafe(`TRUNCATE TABLE events, positions RESTART IDENTITY CASCADE;`);

  for (const ticket of CURATED_TICKETS) {
    const { position } = await createPosition(sql, { params: ticket.params });
    for (const event of ticket.events) {
      await FLOW_REGISTRY[event.flow].run(sql, position.id, event.payload);
    }
  }

  console.log(`[seed] inserted ${CURATED_TICKETS.length} positions across 4 products with lifecycle events`);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
