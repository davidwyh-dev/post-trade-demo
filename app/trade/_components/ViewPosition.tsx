'use client';

import { useTradeStore } from '@/lib/store/tradeStore';
import { useMemo } from 'react';
import { cn, formatNotional } from '@/lib/utils';

const EVENT_ACTIONS: Record<string, string[]> = {
  IRS:      ['AMEND','RATE_RESET','COUPON','NOVATION','TERMINATION','PARTIAL_UNWIND','CANCEL'],
  FUTURE:   ['AMEND','EXPIRY','ROLL','CANCEL'],
  TREASURY: ['AMEND','COUPON','TERMINATION','CANCEL'],
  FX:       ['AMEND','ROLL','TERMINATION','CANCEL'],
};

export function ViewPosition({ positionId }: { positionId: number }) {
  const positions = useTradeStore((s) => s.positions);
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const position = useMemo(() => positions.find((p) => p.id === positionId), [positions, positionId]);

  if (!position) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const params = position.params as Record<string, unknown>;
  const fields = Object.entries(params).filter(([k]) => k !== 'product');

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Product</dt>
        <dd className="font-medium">{position.product}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="font-medium">{position.status}</dd>
        <dt className="text-muted-foreground">ID</dt>
        <dd className="font-mono text-xs">{position.id}</dd>
        <dt className="text-muted-foreground">Position key</dt>
        <dd className="font-mono text-[10px] break-all opacity-60">{position.positionKey}</dd>
      </dl>

      <div className="border-t border-border pt-3">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Parameters</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm font-mono">
          {fields.map(([k, v]) => (
            <FieldRow key={k} field={k} value={v} />
          ))}
        </dl>
      </div>

      <div className="border-t border-border pt-3">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Append event</h3>
        <div className="flex flex-wrap gap-2">
          {(EVENT_ACTIONS[position.product] ?? []).map((eventType) => (
            <button
              key={eventType}
              type="button"
              onClick={() => setDetails({ kind: 'event', positionId, eventType })}
              className={cn(
                'px-2.5 py-1 text-xs rounded border border-border-strong',
                'hover:bg-panel-elevated transition-colors',
              )}
            >
              {eventType.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ field, value }: { field: string; value: unknown }) {
  let display: string;
  if (typeof value === 'number' && (field === 'notional' || field === 'initialFaceAmount' || field === 'notionalBase')) {
    display = formatNotional(value);
  } else if (typeof value === 'number') {
    display = value.toLocaleString();
  } else {
    display = String(value);
  }
  return (
    <>
      <dt className="text-muted-foreground text-xs">{field}</dt>
      <dd>{display}</dd>
    </>
  );
}
