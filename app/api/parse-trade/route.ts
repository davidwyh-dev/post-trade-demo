import { NextResponse } from 'next/server';
import { getReaderSql } from '@/lib/db/client';
import { resolvePosition } from '@/lib/positions/query';
import { PositionParams } from '@/lib/positions/params';
import { toPositionError } from '@/lib/positions/errors';
import { parseTrade } from '@/lib/parser/anthropic';

export const dynamic = 'force-dynamic';

// POST { text: string, contextPositionId: number | null }
//
// Two response shapes (mirrored by app/trade/_components/TradeCli.tsx):
//   { ok: true, intent: 'CREATE', product, params, suggestedPositionId, confidence, summary }
//   { ok: true, intent: 'EVENT',  positionId, eventType, payload, confidence, summary }
//   { ok: false, error: { message } }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const contextPositionId =
    typeof body?.contextPositionId === 'number' ? body.contextPositionId : null;

  if (!text) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: 'text is required' } },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseTrade(text, contextPositionId);

    if (parsed.tool === 'propose_create_position') {
      // The model fills `params` per the system prompt's product schema. Strict
      // server-side validation via the discriminated union catches anything
      // missing or wrong-shaped before it reaches the database.
      const validated = PositionParams.parse({
        product: parsed.product,
        ...parsed.params,
      });
      const resolved = await resolvePosition(getReaderSql(), validated);
      return NextResponse.json({
        ok: true,
        intent: 'CREATE',
        product: validated.product,
        params: validated,
        suggestedPositionId: resolved.positionId,
        confidence: parsed.confidence,
        summary: parsed.summary,
      });
    }

    // EVENT
    const positionId = parsed.positionId ?? contextPositionId;
    if (!positionId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            kind: 'validation',
            message:
              'No position context. Type a trade first, or click a row above before requesting an event.',
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      intent: 'EVENT',
      positionId,
      eventType: parsed.eventType,
      payload: parsed.payload,
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
