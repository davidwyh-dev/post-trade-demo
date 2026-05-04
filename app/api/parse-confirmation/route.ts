import { NextResponse } from 'next/server';
import { parseConfirmationCommand } from '@/lib/parser/confirmations-anthropic';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

// POST { text: string, visibleEventIds: number[] }
//
// Two response shapes (mirrored by app/confirmations/_components/ConfirmationsCli.tsx):
//   { ok: true, intent: 'FILTER', filter, confidence, summary }
//   { ok: true, intent: 'SELECT', eventIds, confidence, summary }
//   { ok: false, error: { message } }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const visibleEventIds = Array.isArray(body?.visibleEventIds)
    ? body.visibleEventIds.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n))
    : [];

  if (!text) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: 'text is required' } },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseConfirmationCommand(text, visibleEventIds);
    if (parsed.tool === 'filter_events') {
      return NextResponse.json({
        ok: true,
        intent: 'FILTER',
        filter: parsed.filter,
        confidence: parsed.confidence,
        summary: parsed.summary,
      });
    }
    return NextResponse.json({
      ok: true,
      intent: 'SELECT',
      eventIds: parsed.eventIds,
      confidence: parsed.confidence,
      summary: parsed.summary,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: toPositionError(err) },
      { status: 400 },
    );
  }
}
