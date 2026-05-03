import postgres, { type Sql } from 'postgres';

declare global {
  var __bor_pg_writer__: Sql | undefined;
  var __bor_pg_reader__: Sql | undefined;
}

function connect(url: string): Sql {
  return postgres(url, {
    max: 5,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 30,
  });
}

function writerUrl(): string {
  const url = process.env.DATABASE_URL_WRITER ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL_WRITER (or DATABASE_URL) is not set. For local dev: `npm run dev:db` and copy .env.local.example to .env.local.',
    );
  }
  return url;
}

function readerUrl(): string {
  return process.env.DATABASE_URL_READER ?? writerUrl();
}

export function getWriterSql(): Sql {
  if (global.__bor_pg_writer__) return global.__bor_pg_writer__;
  global.__bor_pg_writer__ = connect(writerUrl());
  return global.__bor_pg_writer__;
}

export function getReaderSql(): Sql {
  const wUrl = writerUrl();
  const rUrl = readerUrl();
  if (wUrl === rUrl) return getWriterSql();
  if (global.__bor_pg_reader__) return global.__bor_pg_reader__;
  global.__bor_pg_reader__ = connect(rUrl);
  return global.__bor_pg_reader__;
}

export function getSqlForRead({ fresh }: { fresh: boolean }): Sql {
  return fresh ? getWriterSql() : getReaderSql();
}

export async function getCurrentLsn(sql: Sql): Promise<string | null> {
  try {
    const [row] = await sql<{ lsn: string }[]>`SELECT pg_current_wal_lsn()::text AS lsn`;
    return row?.lsn ?? null;
  } catch {
    return null;
  }
}

export async function waitForLsn(sql: Sql, lsn: string, timeoutMs = 500): Promise<boolean> {
  try {
    const [{ in_recovery }] = await sql<{ in_recovery: boolean }[]>`
      SELECT pg_is_in_recovery() AS in_recovery
    `;
    if (!in_recovery) return true;
  } catch {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [{ caught_up }] = await sql<{ caught_up: boolean }[]>`
        SELECT pg_last_wal_replay_lsn() >= ${lsn}::pg_lsn AS caught_up
      `;
      if (caught_up) return true;
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}
