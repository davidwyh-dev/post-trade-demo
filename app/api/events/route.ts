import { NextResponse } from 'next/server';
import { getReaderSql } from '@/lib/db/client';
import { listEventsByDateRange } from '@/lib/positions/query';
import { listEvents as listEventsForPosition } from '@/lib/positions/query';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Default range is today/today.
//
// Returns: { ok: true, events: EnrichedEvent[], allEventsByPosition: { [positionId]: Event[] } }
//   The sibling map lets the client resolve AMEND-chain overrides without a
//   second round trip — needed by Events Summary and Event Details.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? today;
  const to   = url.searchParams.get('to') ?? today;

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: 'from and to must be YYYY-MM-DD' } },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: '`from` must be on or before `to`' } },
      { status: 400 },
    );
  }

  const sql = getReaderSql();
  const events = await listEventsByDateRange(sql, from, to);

  // For amendment-chain resolution we need ALL events on each touched position,
  // not just those in the date window — an AMEND that restates a prior event
  // could fall outside the filter. Load once per distinct position.
  const positionIds = Array.from(new Set(events.map((e) => e.positionId)));
  const allByPosition: Record<number, Awaited<ReturnType<typeof listEventsForPosition>>> = {};
  await Promise.all(
    positionIds.map(async (pid) => {
      allByPosition[pid] = await listEventsForPosition(sql, pid);
    }),
  );

  return NextResponse.json({ ok: true, events, allEventsByPosition: allByPosition });
}
