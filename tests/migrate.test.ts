import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import postgres, { type Sql } from 'postgres';
import { applyMigrations } from '@/lib/db/migrate';

// We share the embedded-pg server started by tests/setup.ts (port 54329) but
// use a SEPARATE database (test_migrate) so we can drop and recreate schema
// freely without disturbing the main test fixtures.
const HOST = '127.0.0.1';
const PORT = 54329;
const PASSWORD = 'bor-test';
const ADMIN_URL = `postgres://postgres:${PASSWORD}@${HOST}:${PORT}/postgres`;
const TEST_DB = 'test_migrate';
const TEST_URL = `postgres://postgres:${PASSWORD}@${HOST}:${PORT}/${TEST_DB}`;

let tmpDir: string;
let admin: Sql;

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { max: 1, prepare: false, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  tmpDir = await mkdtemp(path.join(tmpdir(), 'migrate-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end({ timeout: 5 });
});

beforeEach(async () => {
  // Drop everything in the test DB and clear the migrations dir.
  const t = postgres(TEST_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await t.unsafe(`
      DROP TABLE IF EXISTS schema_migrations;
      DROP TABLE IF EXISTS test_a;
      DROP TABLE IF EXISTS test_b;
      DROP TABLE IF EXISTS test_c;
    `);
  } finally {
    await t.end({ timeout: 5 });
  }
  for (const f of ['001_a.sql', '002_b.sql', '003_c.sql']) {
    await rm(path.join(tmpDir, f), { force: true });
  }
});

const A = `CREATE TABLE test_a (id INT PRIMARY KEY);`;
const B = `CREATE TABLE test_b (id INT PRIMARY KEY);`;
const C = `CREATE TABLE test_c (id INT PRIMARY KEY);`;

async function writeMigrations(files: Record<string, string>): Promise<void> {
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(tmpDir, name), body, 'utf8');
  }
}

async function tablesIn(db: string): Promise<string[]> {
  const url = `postgres://postgres:${PASSWORD}@${HOST}:${PORT}/${db}`;
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    return rows.map((r) => r.tablename);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

describe('applyMigrations: fresh database', () => {
  it('applies every file once and records them in schema_migrations', async () => {
    await writeMigrations({ '001_a.sql': A, '002_b.sql': B, '003_c.sql': C });

    const r = await applyMigrations(TEST_URL, tmpDir, { log: () => {} });
    expect(r.applied).toEqual(['001_a.sql', '002_b.sql', '003_c.sql']);
    expect(r.skipped).toEqual([]);
    expect(r.baselined).toEqual([]);

    expect(await tablesIn(TEST_DB)).toEqual(['schema_migrations', 'test_a', 'test_b', 'test_c']);
  });
});

describe('applyMigrations: re-run', () => {
  it('skips already-applied files (re-run is a no-op)', async () => {
    await writeMigrations({ '001_a.sql': A, '002_b.sql': B });

    await applyMigrations(TEST_URL, tmpDir, { log: () => {} });
    const r = await applyMigrations(TEST_URL, tmpDir, { log: () => {} });

    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual(['001_a.sql', '002_b.sql']);
    expect(r.baselined).toEqual([]);
  });

  it('applies only the NEW file when one is added between runs', async () => {
    await writeMigrations({ '001_a.sql': A, '002_b.sql': B });
    await applyMigrations(TEST_URL, tmpDir, { log: () => {} });

    // Operator adds a third migration.
    await writeMigrations({ '003_c.sql': C });

    const r = await applyMigrations(TEST_URL, tmpDir, { log: () => {} });
    expect(r.applied).toEqual(['003_c.sql']);
    expect(r.skipped).toEqual(['001_a.sql', '002_b.sql']);
  });
});

describe('applyMigrations: checksum guard', () => {
  it('rejects re-running an applied file whose contents changed', async () => {
    await writeMigrations({ '001_a.sql': A });
    await applyMigrations(TEST_URL, tmpDir, { log: () => {} });

    // Edit the file in place — operator mistake we want to catch.
    await writeMigrations({ '001_a.sql': `${A}\n-- tampered` });

    await expect(
      applyMigrations(TEST_URL, tmpDir, { log: () => {} }),
    ).rejects.toThrow(/content has changed/i);
  });
});

describe('applyMigrations: baseline mode', () => {
  it('records every file as applied without running its SQL', async () => {
    await writeMigrations({ '001_a.sql': A, '002_b.sql': B, '003_c.sql': C });

    const r = await applyMigrations(TEST_URL, tmpDir, { baseline: true, log: () => {} });
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.baselined).toEqual(['001_a.sql', '002_b.sql', '003_c.sql']);

    // Tracking table exists, but the test_X tables do NOT (since DDL was skipped).
    expect(await tablesIn(TEST_DB)).toEqual(['schema_migrations']);
  });

  it('after baseline, a NEW file applies normally on the next run', async () => {
    await writeMigrations({ '001_a.sql': A, '002_b.sql': B });
    await applyMigrations(TEST_URL, tmpDir, { baseline: true, log: () => {} });

    await writeMigrations({ '003_c.sql': C });
    const r = await applyMigrations(TEST_URL, tmpDir, { log: () => {} });

    expect(r.applied).toEqual(['003_c.sql']);
    expect(r.skipped).toEqual(['001_a.sql', '002_b.sql']);
    expect(await tablesIn(TEST_DB)).toEqual(['schema_migrations', 'test_c']);
  });
});
