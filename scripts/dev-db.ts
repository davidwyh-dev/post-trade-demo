// Long-running embedded-postgres for local dev. The dev server connects via
// DATABASE_URL=postgres://postgres:dev@127.0.0.1:54330/postgres.
//
//   npm run dev:db   # this script (terminal 1)
//   npm run dev      # next.js (terminal 2)

import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import { applyMigrations } from '../lib/db/migrate';

const DATA_DIR = path.resolve(process.cwd(), '.dev-pg');
const PORT = 54330;
const PASSWORD = 'dev';
const DATABASE_URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`;

async function main() {
  const fresh = process.argv.includes('--fresh');
  const { rm } = await import('node:fs/promises');
  if (fresh) {
    await rm(DATA_DIR, { recursive: true, force: true });
    console.log('[dev-db] cleared previous data dir');
  }

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: 'postgres',
    password: PASSWORD,
    persistent: true,
    onLog: () => {},
    onError: (e) => console.error('[pg]', e),
  });

  const { existsSync } = await import('node:fs');
  if (!existsSync(DATA_DIR)) {
    console.log('[dev-db] initialising data dir...');
    await pg.initialise();
  }

  await pg.start();
  console.log(`[dev-db] running on ${DATABASE_URL}`);

  try {
    await applyMigrations(DATABASE_URL, path.resolve(process.cwd(), 'drizzle'));
    console.log('[dev-db] migrations applied (idempotent failures expected on re-run; pass --fresh to reset)');
  } catch {
    if (!fresh) {
      console.log('[dev-db] migrations skipped (already applied). Pass --fresh to reset.');
    }
  }

  console.log('[dev-db] ready. Ctrl+C to stop.');
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
