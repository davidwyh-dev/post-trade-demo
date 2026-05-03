'use client';

import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTradeStore } from '@/lib/store/tradeStore';
import { buildGraph } from '@/lib/viz/dag/buildGraph';
import { layoutGraph } from '@/lib/viz/dag/layout';
import { EventNode } from './EventNode';

const nodeTypes = { event: EventNode };

export function EventDag() {
  const events = useTradeStore((s) => s.events);
  const selectedId = useTradeStore((s) => s.selectedPositionId);

  const { nodes, edges } = useMemo(() => {
    const graph = buildGraph(events);
    const laid = layoutGraph(graph.nodes, graph.edges);
    const flowNodes: Node[] = laid.nodes.map((n) => ({
      id: n.id,
      type: 'event',
      position: n.position,
      data: {
        sequenceNo: n.sequenceNo,
        eventType: n.eventType,
        payload: n.payload,
        effectiveAt: n.effectiveAt,
        isLatest: n.isLatest,
      },
      draggable: false,
    }));
    const flowEdges: Edge[] = laid.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: false,
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [events]);

  return (
    <div className="w-full h-full flex flex-col">
      <header className="px-4 py-2 border-b border-border bg-panel">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Event DAG
        </h2>
        <p className="text-xs text-muted-foreground">
          {selectedId === null
            ? 'Select a position to see its event chain.'
            : events.length === 0
              ? 'Loading…'
              : `${events.length} events · latest is ringed in accent.`}
        </p>
      </header>
      <div className="flex-1 min-h-0">
        {selectedId !== null && events.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background gap={24} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <div className="h-full grid place-items-center text-muted-foreground text-sm">
            {selectedId === null ? '—' : 'No events.'}
          </div>
        )}
      </div>
    </div>
  );
}
