'use client';

import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTradeStore } from '@/lib/store/tradeStore';
import { buildGraph } from '@/lib/viz/dag/buildGraph';
import { layoutGraph } from '@/lib/viz/dag/layout';
import { mergeProjections } from '@/lib/viz/dag/mergeProjections';
import { projectFutureEvents } from '@/lib/positions/projections';
import { cn } from '@/lib/utils';
import { EventNode } from './EventNode';

const nodeTypes = { event: EventNode };

export function EventDag() {
  const events = useTradeStore((s) => s.events);
  const positions = useTradeStore((s) => s.positions);
  const selectedId = useTradeStore((s) => s.selectedPositionId);
  const showProjected = useTradeStore((s) => s.showProjected);
  const setShowProjected = useTradeStore((s) => s.setShowProjected);

  const selectedPosition = useMemo(
    () => (selectedId === null ? null : positions.find((p) => p.id === selectedId) ?? null),
    [positions, selectedId],
  );

  const { nodes, edges, projectedCount } = useMemo(() => {
    const base = buildGraph(events);
    const projections =
      showProjected && selectedPosition
        ? projectFutureEvents(selectedPosition, events, new Date())
        : [];
    const graph = mergeProjections(base, projections);
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
        isProjected: n.isProjected ?? false,
      },
      draggable: false,
    }));
    const flowEdges: Edge[] = laid.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: e.isProjected ?? false,
      style: e.isProjected ? { strokeDasharray: '4 4', opacity: 0.6 } : undefined,
    }));
    return { nodes: flowNodes, edges: flowEdges, projectedCount: projections.length };
  }, [events, showProjected, selectedPosition]);

  const showToggle = selectedId !== null && events.length > 0;

  return (
    <div className="w-full h-full flex flex-col">
      <header className="px-4 py-2 border-b border-border bg-panel flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Event DAG
          </h2>
          <p className="text-xs text-muted-foreground">
            {selectedId === null
              ? 'Select a position to see its event chain.'
              : events.length === 0
                ? 'Loading…'
                : showProjected && projectedCount > 0
                  ? `${events.length} events · ${projectedCount} projected`
                  : `${events.length} events · latest is ringed in accent.`}
          </p>
        </div>
        {showToggle && (
          <button
            type="button"
            aria-pressed={showProjected}
            onClick={() => setShowProjected(!showProjected)}
            className={cn(
              'shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors',
              showProjected
                ? 'border-accent text-accent bg-accent/10'
                : 'border-border text-muted-foreground hover:bg-panel-elevated',
            )}
          >
            Projected
          </button>
        )}
      </header>
      <div className="flex-1 min-h-0">
        {selectedId !== null && events.length > 0 ? (
          <ReactFlow
            key={`${selectedId}-${showProjected ? 'p' : 'r'}`}
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
