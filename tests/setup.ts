import { afterAll, beforeAll, beforeEach } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { applyMigrations } from '@/lib/db/migrate';
import * as schema from '@/lib/db/schema';

const DATA_DIR = path.resolve(process.cwd(), '.tmp/test-pg');
const PORT = 54329;
const PASSWORD = 'bor-test';
const DATABASE_URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`;

let pg: EmbeddedPostgres | undefined;
let sql: ReturnType<typeof postgres> | undefined;

export const getDb = () => {
  if (!sql) throw new Error('Test DB not initialized; did beforeAll run?');
  return drizzle(sql, { schema });
};

export const getSql = () => {
  if (!sql) throw new Error('Test DB not initialized; did beforeAll run?');
  return sql;
};

beforeAll(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });

  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: 'postgres',
    password: PASSWORD,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();

  await applyMigrations(DATABASE_URL, path.resolve(process.cwd(), 'drizzle'));

  sql = postgres(DATABASE_URL, { max: 5, prepare: false, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await pg?.stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  if (!sql) return;
  // Reset positions+events but keep counterparties seeded.
  // TRUNCATE bypasses our append-only triggers (they fire on UPDATE/DELETE,
  // not TRUNCATE) — that's intentional so tests can reset cleanly.
  await sql.unsafe(`
    TRUNCATE TABLE events, positions RESTART IDENTITY CASCADE;
  `);
});
