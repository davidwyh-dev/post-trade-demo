'use client';

import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { EventType } from '@/lib/db/schema';

const EVENT_COLOR: Record<EventType, string> = {
  NEW:             'border-[var(--event-new)]            text-[var(--event-new)]',
  AMEND:           'border-[var(--event-amend)]          text-[var(--event-amend)]',
  RATE_RESET:      'border-[var(--event-rate-reset)]     text-[var(--event-rate-reset)]',
  COUPON:          'border-[var(--event-coupon)]         text-[var(--event-coupon)]',
  NOVATION:        'border-[var(--event-novation)]       text-[var(--event-novation)]',
  TERMINATION:     'border-[var(--event-termination)]    text-[var(--event-termination)]',
  ROLL:            'border-[var(--event-roll)]           text-[var(--event-roll)]',
  EXPIRY:          'border-[var(--event-expiry)]         text-[var(--event-expiry)]',
  CANCEL:          'border-[var(--event-cancel)]         text-[var(--event-cancel)]',
  PARTIAL_UNWIND:  'border-[var(--event-partial-unwind)] text-[var(--event-partial-unwind)]',
};

type Props = {
  data: {
    sequenceNo: number;
    eventType: EventType;
    payload: Record<string, unknown>;
    effectiveAt: string;
    isLatest: boolean;
    isProjected?: boolean;
  };
};

export function EventNode({ data }: Props) {
  const colorClasses = EVENT_COLOR[data.eventType];
  const subtitle = renderSubtitle(data.eventType, data.payload);
  const dateLabel = data.effectiveAt.slice(0, 10);

  return (
    <div
      className={cn(
        'rounded-md border-2 bg-panel-elevated px-3 py-2 shadow-sm font-mono text-xs',
        'min-w-[180px] max-w-[200px]',
        colorClasses,
        data.isLatest && !data.isProjected && 'ring-2 ring-accent ring-offset-1 ring-offset-background',
        data.isProjected && 'border-dashed opacity-60 bg-transparent',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border-strong !border-border" />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider opacity-70">
        <span>{data.isProjected ? 'proj' : `#${data.sequenceNo}`}</span>
        <span>{data.isProjected ? `~${dateLabel}` : dateLabel}</span>
      </div>
      <div className="font-semibold mt-0.5 text-[13px]">{data.eventType}</div>
      {subtitle && <div className="text-[11px] text-foreground/80 mt-0.5">{subtitle}</div>}
      <Handle type="source" position={Position.Right} className="!bg-border-strong !border-border" />
    </div>
  );
}

function renderSubtitle(type: EventType, p: Record<string, unknown>): string | null {
  switch (type) {
    case 'AMEND': {
      const parts: string[] = [];
      if (p.newNotional) parts.push(`notional → ${(p.newNotional as number).toLocaleString()}`);
      if (p.newRate) parts.push(`rate → ${p.newRate}`);
      if (p.newQuantity) parts.push(`qty → ${(p.newQuantity as number).toLocaleString()}`);
      return parts.join(' · ') || null;
    }
    case 'RATE_RESET':
      return p.fixingRate ? `fix ${p.fixingRate}%` : null;
    case 'COUPON':
      return p.amount ? `${(p.amount as number).toLocaleString()} ${p.currency}` : null;
    case 'NOVATION':
      return `${p.fromCounterparty} → ${p.toCounterparty}`;
    case 'TERMINATION':
      return p.settlementAmount ? `settle ${(p.settlementAmount as number).toLocaleString()} ${p.currency}` : null;
    case 'ROLL':
      return p.toValueDate ? `to ${p.toValueDate}` : null;
    case 'EXPIRY':
      return p.finalSettlement ? `final ${p.finalSettlement}` : null;
    case 'PARTIAL_UNWIND':
      return p.unwoundAmount ? `${(p.unwoundAmount as number).toLocaleString()} ${p.currency}` : null;
    case 'CANCEL':
      return typeof p.reason === 'string' ? p.reason.slice(0, 30) : null;
    case 'NEW':
    default:
      return null;
  }
}
