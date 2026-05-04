import type { Event } from '@/lib/db/schema';

/**
 * Walks the event chain and returns a merged payload for `target` that includes
 * every later AMEND whose payload.targetEventSequenceNo === target.sequenceNo.
 *
 * Original event payload remains the system-of-record; this helper layers
 * operator restatements on top in chronological order. Used by the
 * Confirmations page to display the *current* effective amount/rate.
 */
export function resolveEffectivePayload(
  target: Event,
  allEventsForPosition: readonly Event[],
): { payload: Record<string, unknown>; amended: boolean; amendingEventIds: number[] } {
  const overrides: Record<string, unknown>[] = [];
  const amendingEventIds: number[] = [];
  for (const e of allEventsForPosition) {
    if (e.eventType !== 'AMEND') continue;
    if (e.sequenceNo <= target.sequenceNo) continue;
    const p = e.payload as Record<string, unknown>;
    if (p.targetEventSequenceNo !== target.sequenceNo) continue;
    const o = p.overrides as Record<string, unknown> | undefined;
    if (o && Object.keys(o).length > 0) {
      overrides.push(o);
      amendingEventIds.push(e.id);
    }
  }
  if (overrides.length === 0) {
    return { payload: target.payload as Record<string, unknown>, amended: false, amendingEventIds: [] };
  }
  const merged = { ...(target.payload as Record<string, unknown>) };
  for (const o of overrides) Object.assign(merged, o);
  return { payload: merged, amended: true, amendingEventIds };
}
