// Apply raw .sql migrations from drizzle/ in lexicographic order.
// We use raw SQL (not drizzle-kit's diff-based migrations) because the
// append-only triggers and constraint triggers are part of the demo's
// surface area — they need to be visible, hand-authored SQL.
//
// State tracking: a `schema_migrations` table records which migration files
// have already been applied (by filename + content checksum). Re-running this
// is safe — applied files are skipped. If a previously-applied file's content
// changes, we error out: migrations are immutable; create a new file instead.
//
// First run against a pre-existing DB (no schema_migrations table yet but
// other tables already created): pass `--baseline` to mark every current .sql
// file as applied without re-running it. Later runs then apply only NEW files.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postgres, { type Sql } from 'postgres';
import { config as loadEnv } from 'dotenv';

export type ApplyMigrationsOptions = {
  /** Mark every current .sql file as applied without running it. Used once to
   *  bring a pre-existing DB into the tracking system. */
  baseline?: boolean;
  /** Optional logger. Defaults to console.log. Pass `() => {}` to silence. */
  log?: (msg: string) => void;
};

export type ApplyMigrationsResult = {
  applied: string[];      // filenames just executed
  skipped: string[];      // filenames already applied (checksum matched)
  baselined: string[];    // filenames recorded as applied without running (--baseline)
};

export async function applyMigrations(
  databaseUrl: string,
  migrationsDir: string,
  opts: ApplyMigrationsOptions = {},
): Promise<ApplyMigrationsResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, connect_timeout: 60 });
  try {
    await ensureTrackingTable(sql);

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied = await loadAppliedSet(sql);

    const result: ApplyMigrationsResult = { applied: [], skipped: [], baselined: [] };

    for (const file of files) {
      const body = await readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = sha256(body);

      const prev = applied.get(file);
      if (prev !== undefined) {
        if (prev !== checksum) {
          throw new Error(
            `Migration ${file} content has changed since it was applied (recorded checksum ${prev.slice(0, 12)}…, current ${checksum.slice(0, 12)}…). ` +
            `Migrations are immutable — create a new .sql file instead of editing this one.`,
          );
        }
        result.skipped.push(file);
        continue;
      }

      if (opts.baseline) {
        await sql`
          INSERT INTO schema_migrations (version, checksum) VALUES (${file}, ${checksum})
        `;
        log(`[migrate] baselined: ${file}`);
        result.baselined.push(file);
        continue;
      }

      // Apply DDL + record the row in one transaction so a crash mid-way leaves
      // the DB in a consistent state. Some statements (CREATE TABLE, etc.) run
      // in implicit transactions — wrapping them again is fine, postgres-js
      // begin() opens an explicit one.
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (version, checksum) VALUES (${file}, ${checksum})`;
      });
      log(`[migrate] applied:   ${file}`);
      result.applied.push(file);
    }

    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function ensureTrackingTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      checksum   CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function loadAppliedSet(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<{ version: string; checksum: string }[]>`
    SELECT version, checksum FROM schema_migrations
  `;
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.version, r.checksum);
  return m;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Load .env.local for CLI invocations. Inline shell env wins over the file.
  loadEnv({ path: path.resolve(process.cwd(), '.env.local') });

  const url = process.env.DATABASE_URL_WRITER ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL_WRITER (or DATABASE_URL) is not set');
    process.exit(1);
  }
  const baseline = process.argv.includes('--baseline');
  applyMigrations(url, path.resolve(process.cwd(), 'drizzle'), { baseline }).then(
    (r) => {
      const verb = baseline ? 'recorded existing migrations' : 'migrations applied';
      console.log(
        `[migrate] ${verb}: ${r.applied.length} applied, ${r.skipped.length} skipped, ${r.baselined.length} baselined`,
      );
      process.exit(0);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
