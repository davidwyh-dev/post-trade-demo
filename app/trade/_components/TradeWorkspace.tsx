'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useTradeStore } from '@/lib/store/tradeStore';
import { PositionTable } from './PositionTable';
import { PositionDetails } from './PositionDetails';
import { EventDag } from './EventDag';
import { TradeCli } from './TradeCli';

export function TradeWorkspace() {
  const setPositions = useTradeStore((s) => s.setPositions);
  const setEvents = useTradeStore((s) => s.setEvents);
  const selectedId = useTradeStore((s) => s.selectedPositionId);

  // Initial positions load.
  useEffect(() => {
    fetch('/api/positions')
      .then((r) => r.json())
      .then((j) => setPositions(j.positions ?? []))
      .catch((e) => toast.error(`Failed to load positions: ${e.message}`));
  }, [setPositions]);

  // Events for the selected position.
  useEffect(() => {
    if (selectedId === null) {
      setEvents([]);
      return;
    }
    fetch(`/api/positions/${selectedId}`)
      .then((r) => r.json())
      .then((j) => setEvents(j.events ?? []))
      .catch((e) => toast.error(`Failed to load events: ${e.message}`));
  }, [selectedId, setEvents]);

  return (
    <div className="grid h-screen w-screen text-foreground"
         style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1.4fr) auto', gridTemplateColumns: '1fr' }}>
      {/* Top: Position Table */}
      <section className="border-b border-border min-h-0 overflow-hidden">
        <PositionTable />
      </section>

      {/* Middle: Details (left) + DAG (right) */}
      <section className="grid min-h-0 overflow-hidden"
               style={{ gridTemplateColumns: '1fr 1.3fr' }}>
        <div className="border-r border-border min-h-0 overflow-y-auto">
          <PositionDetails />
        </div>
        <div className="min-h-0">
          <EventDag />
        </div>
      </section>

      {/* Bottom: Trade CLI */}
      <section className="border-t border-border">
        <TradeCli />
      </section>
    </div>
  );
}
