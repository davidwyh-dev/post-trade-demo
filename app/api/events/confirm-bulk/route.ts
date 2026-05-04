import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getWriterSql } from '@/lib/db/client';
import { bulkUpsertEventConfirmations } from '@/lib/positions/query';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({
  eventIds:        z.array(z.number().int().positive()).min(1),
  amountConfirmed: z.boolean(),
  reconciled:      z.boolean(),
  notes:           z.string().nullable().optional(),
});

// POST /api/events/confirm-bulk  body = { eventIds, amountConfirmed, reconciled, notes? }
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: parsed.error.message } },
      { status: 400 },
    );
  }

  try {
    const confirmations = await bulkUpsertEventConfirmations(
      getWriterSql(),
      parsed.data.eventIds,
      {
        amountConfirmed: parsed.data.amountConfirmed,
        reconciled:      parsed.data.reconciled,
        notes:           parsed.data.notes ?? null,
      },
    );
    return NextResponse.json({ ok: true, confirmations });
  } catch (err) {
    return NextResponse.json({ ok: false, error: toPositionError(err) }, { status: 400 });
  }
}
