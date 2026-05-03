import { NextResponse } from 'next/server';
import { getReaderSql } from '@/lib/db/client';
import { getPosition, listEvents } from '@/lib/positions/query';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const positionId = Number(id);
  if (!Number.isFinite(positionId)) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'Invalid id' } }, { status: 400 });
  }
  const sql = getReaderSql();
  const position = await getPosition(sql, positionId);
  if (!position) {
    return NextResponse.json({ ok: false, error: { kind: 'not-found', message: 'Position not found' } }, { status: 404 });
  }
  const events = await listEvents(sql, positionId);
  return NextResponse.json({ ok: true, position, events });
}
