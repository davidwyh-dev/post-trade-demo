import dagre from 'dagre';
import type { DagNode, DagEdge } from './buildGraph';

export type LaidOutNode = DagNode & { position: { x: number; y: number } };

const NODE_W = 200;
const NODE_H = 72;

export function layoutGraph(
  nodes: DagNode[],
  edges: DagEdge[],
): { nodes: LaidOutNode[]; edges: DagEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  const laidOut: LaidOutNode[] = nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return {
      ...n,
      position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
    };
  });

  return { nodes: laidOut, edges };
}
