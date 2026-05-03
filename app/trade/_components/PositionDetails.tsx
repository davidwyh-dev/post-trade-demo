'use client';

import { useTradeStore } from '@/lib/store/tradeStore';
import { ViewPosition } from './ViewPosition';
import { NewPositionForm } from './NewPositionForm';
import { EventForm } from './EventForm';

export function PositionDetails() {
  const mode = useTradeStore((s) => s.detailsMode);

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2 border-b border-border bg-panel">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          {mode.kind === 'create' ? 'New position'
           : mode.kind === 'event' ? `New ${mode.eventType.toLowerCase()} event`
           : mode.kind === 'view' ? 'Position details'
           : 'Position details'}
        </h2>
        <p className="text-xs text-muted-foreground">
          {mode.kind === 'idle'
            ? 'Select a position above, or type a trade in the CLI below.'
            : mode.kind === 'view'
              ? 'Read-only — to amend, type an event in the CLI or use the actions below.'
              : mode.kind === 'create'
                ? 'Fill in the params and submit. Position identity is derived from the highlighted fields.'
                : 'Fill in the event payload and submit. The event will be appended to the position.'}
        </p>
      </header>
      <div className="flex-1 overflow-auto p-4">
        {mode.kind === 'view' && <ViewPosition positionId={mode.positionId} />}
        {mode.kind === 'create' && <NewPositionForm prefill={mode.prefill} />}
        {mode.kind === 'event' && <EventForm positionId={mode.positionId} eventType={mode.eventType} prefill={mode.prefill} />}
        {mode.kind === 'idle' && (
          <div className="text-sm text-muted-foreground text-center pt-12">—</div>
        )}
      </div>
    </div>
  );
}
