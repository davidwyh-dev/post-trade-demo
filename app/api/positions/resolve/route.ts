import { NextResponse } from 'next/server';
import { getReaderSql } from '@/lib/db/client';
import { resolvePosition } from '@/lib/positions/query';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

// POST { params } -> { positionId | null, product, positionKey }
//
// Used by the Trade CLI: parse free text -> structured params -> resolve here
// to decide whether to select an existing position or open the new-position form.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const result = await resolvePosition(getReaderSql(), body?.params);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: toPositionError(err) }, { status: 400 });
  }
}
