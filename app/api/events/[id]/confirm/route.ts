import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getWriterSql } from '@/lib/db/client';
import { upsertEventConfirmation } from '@/lib/positions/query';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({
  amountConfirmed: z.boolean().optional(),
  reconciled:      z.boolean().optional(),
  notes:           z.string().nullable().optional(),
}).refine(
  (v) => v.amountConfirmed !== undefined || v.reconciled !== undefined || v.notes !== undefined,
  { message: 'patch must include at least one of amountConfirmed, reconciled, notes' },
);

// POST /api/events/{id}/confirm  body = { amountConfirmed?, reconciled?, notes? }
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ ok: false, error: { kind: 'validation', message: 'Invalid id' } }, { status: 400 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: parsed.error.message } },
      { status: 400 },
    );
  }

  try {
    const confirmation = await upsertEventConfirmation(getWriterSql(), eventId, parsed.data);
    return NextResponse.json({ ok: true, confirmation });
  } catch (err) {
    return NextResponse.json({ ok: false, error: toPositionError(err) }, { status: 400 });
  }
}
