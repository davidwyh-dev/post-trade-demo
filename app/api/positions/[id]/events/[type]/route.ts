import { NextResponse } from 'next/server';
import { getWriterSql } from '@/lib/db/client';
import { FLOW_REGISTRY, type FlowName } from '@/lib/positions/flows';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

// POST /api/positions/{id}/events/{type}  -> appends one event of `type`
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string }> },
) {
  const { id, type } = await ctx.params;
  const positionId = Number(id);
  if (!Number.isFinite(positionId)) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'Invalid id' } }, { status: 400 });
  }
  if (!(type in FLOW_REGISTRY)) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: `Unknown event type: ${type}` } },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const idempotencyKey =
    req.headers.get('Idempotency-Key') ??
    (typeof body?.externalId === 'string' ? body.externalId : null) ??
    crypto.randomUUID();

  try {
    const event = await FLOW_REGISTRY[type as FlowName].run(
      getWriterSql(),
      positionId,
      { ...body, externalId: idempotencyKey },
    );
    const headers = new Headers();
    if (event.lsn) headers.set('X-Postgres-Lsn', event.lsn);
    if (event.replayed) headers.set('Idempotency-Replayed', 'true');
    return NextResponse.json(
      { ok: true, event },
      { status: event.replayed ? 200 : 201, headers },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: toPositionError(err) }, { status: 400 });
  }
}
