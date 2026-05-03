// Apply raw .sql migrations from drizzle/ in lexicographic order.
// We use raw SQL (not drizzle-kit's diff-based migrations) because the
// append-only triggers and constraint triggers are part of the demo's
// surface area — they need to be visible, hand-authored SQL.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

export async function applyMigrations(databaseUrl: string, migrationsDir: string) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, connect_timeout: 60 });
  try {
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const body = await readFile(fullPath, 'utf8');
      await sql.unsafe(body);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Load .env.local for CLI invocations.
  const { config } = await import('dotenv');
  const { resolve } = await import('node:path');
  config({ path: resolve(process.cwd(), '.env.local') });

  const url = process.env.DATABASE_URL_WRITER ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL_WRITER (or DATABASE_URL) is not set');
    process.exit(1);
  }
  applyMigrations(url, path.resolve(process.cwd(), 'drizzle')).then(
    () => {
      console.log('Migrations applied');
      process.exit(0);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
