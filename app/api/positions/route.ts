import { NextResponse } from 'next/server';
import { getReaderSql, getWriterSql } from '@/lib/db/client';
import { listPositions } from '@/lib/positions/query';
import { createPosition } from '@/lib/positions/create';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const positions = await listPositions(getReaderSql());
  return NextResponse.json({ positions });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const idempotencyKey =
    req.headers.get('Idempotency-Key') ??
    (typeof body?.externalId === 'string' ? body.externalId : null) ??
    crypto.randomUUID();

  try {
    const result = await createPosition(getWriterSql(), {
      params: body?.params,
      externalId: idempotencyKey,
    });
    const headers = new Headers();
    if (result.lsn) headers.set('X-Postgres-Lsn', result.lsn);
    if (result.matched) headers.set('Idempotency-Replayed', 'true');
    return NextResponse.json(
      { ok: true, result },
      { status: result.matched ? 200 : 201, headers },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: toPositionError(err) }, { status: 400 });
  }
}
