import type { DagNode, DagEdge } from './buildGraph';
import type { ProjectedEvent } from '@/lib/positions/projections';

// Append synthetic projected nodes (and chained edges) to a built graph.
// Returns a new graph; does not mutate the input.
export function mergeProjections(
  graph: { nodes: DagNode[]; edges: DagEdge[] },
  projections: ProjectedEvent[],
): { nodes: DagNode[]; edges: DagEdge[] } {
  if (projections.length === 0) return graph;

  const sorted = [...projections].sort((a, b) =>
    a.effectiveAt.localeCompare(b.effectiveAt),
  );

  // Chain projections off the highest-sequenceNo existing node, matching
  // the same node `isLatest` already marks. If there are no existing
  // events, projections form their own chain.
  const lastReal = graph.nodes.reduce<DagNode | null>(
    (acc, n) => (acc === null || n.sequenceNo > acc.sequenceNo ? n : acc),
    null,
  );
  const baseSeq = lastReal?.sequenceNo ?? 0;

  const newNodes: DagNode[] = sorted.map((p, i) => ({
    id: p.id,
    eventId: -(i + 1),
    sequenceNo: baseSeq + i + 1,
    eventType: p.eventType,
    payload: p.payload,
    effectiveAt: p.effectiveAt,
    isLatest: false,
    isProjected: true,
  }));

  const newEdges: DagEdge[] = [];
  let prevId = lastReal?.id ?? null;
  for (const node of newNodes) {
    if (prevId !== null) {
      newEdges.push({
        id: `e${prevId}-${node.id}`,
        source: prevId,
        target: node.id,
        isProjected: true,
      });
    }
    prevId = node.id;
  }

  return {
    nodes: [...graph.nodes, ...newNodes],
    edges: [...graph.edges, ...newEdges],
  };
}
