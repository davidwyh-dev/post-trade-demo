import type { Event } from '@/lib/db/schema';

export type DagNode = {
  id: string;          // string form of event id
  eventId: number;
  sequenceNo: number;
  eventType: Event['eventType'];
  payload: Record<string, unknown>;
  effectiveAt: string; // ISO date
  isLatest: boolean;
};

export type DagEdge = {
  id: string;
  source: string;
  target: string;
};

export function buildGraph(events: Event[]): { nodes: DagNode[]; edges: DagEdge[] } {
  if (events.length === 0) return { nodes: [], edges: [] };
  const sorted = [...events].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const latestId = sorted[sorted.length - 1].id;

  const nodes: DagNode[] = sorted.map((e) => ({
    id: String(e.id),
    eventId: e.id,
    sequenceNo: e.sequenceNo,
    eventType: e.eventType,
    payload: e.payload as Record<string, unknown>,
    effectiveAt: typeof e.effectiveAt === 'string' ? e.effectiveAt : e.effectiveAt.toISOString(),
    isLatest: e.id === latestId,
  }));

  const edges: DagEdge[] = [];
  for (const e of sorted) {
    if (e.parentEventId !== null) {
      edges.push({
        id: `e${e.parentEventId}-${e.id}`,
        source: String(e.parentEventId),
        target: String(e.id),
      });
    }
  }
  return { nodes, edges };
}
