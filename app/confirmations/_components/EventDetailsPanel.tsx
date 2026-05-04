'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useConfirmationsStore } from '@/lib/store/confirmationsStore';
import { deriveConfirmationStatus } from '@/lib/db/schema';
import { resolveEffectivePayload } from '@/lib/positions/amendments';
import { cn, formatNotional } from '@/lib/utils';

const STATUS_CLASS: Record<string, string> = {
  PENDING:          'bg-status-terminated/15 text-status-terminated',
  AMOUNT_CONFIRMED: 'bg-event-amend/15 text-event-amend',
  SETTLED:          'bg-status-open/15 text-status-open',
};

export function EventDetailsPanel({ onReload }: { onReload: () => void }) {
  const events             = useConfirmationsStore((s) => s.events);
  const selectedIds        = useConfirmationsStore((s) => s.selectedEventIds);
  const paginatedIndex     = useConfirmationsStore((s) => s.paginatedIndex);
  const next               = useConfirmationsStore((s) => s.nextPage);
  const prev               = useConfirmationsStore((s) => s.prevPage);
  const allByPosition      = useConfirmationsStore((s) => s.allEventsByPosition);
  const [busy, setBusy]    = useState(false);

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const event = selectedIds.length > 0
    ? eventById.get(selectedIds[Math.min(paginatedIndex, selectedIds.length - 1)])
    : null;

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <p className="text-xs text-muted-foreground italic text-center">
          Select one or more events from the table to inspect them here.
        </p>
      </div>
    );
  }

  const status = deriveConfirmationStatus(event.confirmation);
  const fullChain = allByPosition[event.positionId] ?? [];
  const { payload, amended, amendingEventIds } = resolveEffectivePayload(event, fullChain);
  const original = event.payload as Record<string, unknown>;
  const params = event.position.params as Record<string, unknown>;

  async function flip(field: 'amountConfirmed' | 'reconciled', value: boolean) {
    if (!event) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${event.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error?.message ?? 'Failed to update confirmation');
        return;
      }
      toast.success(`${field === 'amountConfirmed' ? 'Amount' : 'Reconciled'} ${value ? 'confirmed' : 'cleared'} on event ${event.id}.`);
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-panel">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Event details
          </h2>
          <p className="text-xs text-muted-foreground">
            #{event.id} · {event.eventType.replaceAll('_', ' ')}
            {selectedIds.length > 1 && (
              <> · {paginatedIndex + 1} of {selectedIds.length} selected</>
            )}
          </p>
        </div>
        {selectedIds.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prev}
              className="p-1 rounded border border-border hover:bg-panel-elevated"
              aria-label="Previous selected event"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={next}
              className="p-1 rounded border border-border hover:bg-panel-elevated"
              aria-label="Next selected event"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</h3>
            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', STATUS_CLASS[status])}>
              {status.replaceAll('_', ' ')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => flip('amountConfirmed', !event.confirmation?.amountConfirmed)}
              className={cn(
                'px-3 py-2 text-xs font-medium rounded border transition-colors disabled:opacity-40',
                event.confirmation?.amountConfirmed
                  ? 'bg-status-open/15 border-status-open/40 text-status-open hover:bg-status-open/25'
                  : 'border-border-strong hover:bg-panel-elevated',
              )}
            >
              {event.confirmation?.amountConfirmed ? '✓ Amount confirmed' : 'Confirm amount'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => flip('reconciled', !event.confirmation?.reconciled)}
              className={cn(
                'px-3 py-2 text-xs font-medium rounded border transition-colors disabled:opacity-40',
                event.confirmation?.reconciled
                  ? 'bg-status-open/15 border-status-open/40 text-status-open hover:bg-status-open/25'
                  : 'border-border-strong hover:bg-panel-elevated',
              )}
            >
              {event.confirmation?.reconciled ? '✓ Reconciled' : 'Mark reconciled'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Amount confirmation acknowledges the cash figure. Reconciled marks payment paid/received.
          </p>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Event payload
            {amended && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-event-amend/15 text-event-amend">
                amended via #{amendingEventIds.join(', #')}
              </span>
            )}
          </h3>
          <KeyValueGrid data={payload} highlightKeys={amended ? Object.keys(payload).filter((k) => payload[k] !== original[k]) : []} />
          {amended && (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Original (pre-amendment)</summary>
              <KeyValueGrid data={original} />
            </details>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Adjust (append AMEND event)
          </h3>
          <AmendmentForm event={event} onSubmitted={onReload} />
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Position
          </h3>
          <div className="rounded border border-border bg-panel-elevated px-3 py-2 text-xs">
            <div className="font-medium mb-1">
              #{event.position.id} · {event.position.product}
              <span className={cn(
                'ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium',
                event.position.status === 'OPEN'        && 'bg-status-open/15 text-status-open',
                event.position.status === 'CLOSED'     && 'bg-status-closed/15 text-status-closed',
                event.position.status === 'TERMINATED' && 'bg-status-terminated/15 text-status-terminated',
              )}>
                {event.position.status}
              </span>
            </div>
            <div className="text-muted-foreground space-y-0.5">
              {Object.entries(params).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[120px_1fr] gap-2 font-mono">
                  <span>{k}</span>
                  <span className="text-foreground/80 truncate">
                    {typeof v === 'number' && k === 'notional' ? formatNotional(v, params.currency as string)
                     : typeof v === 'number' && k === 'initialFaceAmount' ? formatNotional(v, params.currency as string)
                     : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function KeyValueGrid({ data, highlightKeys = [] }: { data: Record<string, unknown>; highlightKeys?: string[] }) {
  const keys = Object.keys(data).filter((k) => k !== 'externalId');
  if (keys.length === 0) {
    return <p className="text-xs text-muted-foreground italic">(empty payload)</p>;
  }
  const highlight = new Set(highlightKeys);
  return (
    <div className="rounded border border-border bg-panel-elevated px-3 py-2 text-xs space-y-0.5 font-mono">
      {keys.map((k) => (
        <div key={k} className={cn(
          'grid grid-cols-[140px_1fr] gap-2',
          highlight.has(k) && 'text-event-amend',
        )}>
          <span className="text-muted-foreground">{k}</span>
          <span className="text-foreground/90 truncate">{formatValue(data[k])}</span>
        </div>
      ))}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toString();
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function AmendmentForm({ event, onSubmitted }: {
  event: { id: number; positionId: number; sequenceNo: number; eventType: string; payload: unknown };
  onSubmitted: () => void;
}) {
  const payload = event.payload as Record<string, unknown>;
  // Per-event-type fields that make sense to override.
  const adjustable = adjustableFieldsFor(event.eventType);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (adjustable.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        This event type does not have user-adjustable fields.
      </p>
    );
  }

  async function submit() {
    setBusy(true);
    try {
      const parsedOverrides: Record<string, unknown> = {};
      for (const f of adjustable) {
        const raw = overrides[f.name];
        if (raw === undefined || raw === '') continue;
        if (f.type === 'number') {
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            toast.error(`Invalid number for ${f.name}`);
            return;
          }
          parsedOverrides[f.name] = n;
        } else {
          parsedOverrides[f.name] = raw;
        }
      }
      if (Object.keys(parsedOverrides).length === 0) {
        toast.info('No fields changed.');
        return;
      }
      const res = await fetch(`/api/positions/${event.positionId}/events/AMEND`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEventSequenceNo: event.sequenceNo,
          overrides: parsedOverrides,
          reason: reason || `restate ${event.eventType.toLowerCase()} #${event.id}`,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error?.message ?? 'Failed to append amendment');
        return;
      }
      toast.success(`Appended AMEND on position #${event.positionId} (seq ${j.event?.sequenceNo}).`);
      setOverrides({});
      setReason('');
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-border bg-panel-elevated px-3 py-2 text-xs space-y-2">
      {adjustable.map((f) => (
        <label key={f.name} className="grid grid-cols-[140px_1fr] gap-2 items-center font-mono">
          <span className="text-muted-foreground">{f.name}</span>
          <input
            type={f.type === 'number' ? 'number' : 'text'}
            step={f.type === 'number' ? 'any' : undefined}
            value={overrides[f.name] ?? ''}
            placeholder={`current: ${formatValue(payload[f.name])}`}
            onChange={(e) => setOverrides({ ...overrides, [f.name]: e.target.value })}
            className="bg-panel border border-border rounded px-2 py-1 text-xs"
          />
        </label>
      ))}
      <label className="grid grid-cols-[140px_1fr] gap-2 items-center font-mono">
        <span className="text-muted-foreground">reason</span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`restate ${event.eventType.toLowerCase()} #${event.id}`}
          className="bg-panel border border-border rounded px-2 py-1 text-xs"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="px-3 py-1 text-xs font-medium rounded border border-border-strong hover:bg-accent/15 hover:border-accent disabled:opacity-40"
      >
        {busy ? 'Appending…' : 'Append AMEND'}
      </button>
    </div>
  );
}

type AdjustableField = { name: string; type: 'number' | 'string' };
function adjustableFieldsFor(eventType: string): AdjustableField[] {
  switch (eventType) {
    case 'RATE_RESET':     return [{ name: 'fixingRate', type: 'number' }];
    case 'COUPON':         return [{ name: 'amount', type: 'number' }];
    case 'TERMINATION':    return [{ name: 'settlementAmount', type: 'number' }];
    case 'PARTIAL_UNWIND': return [{ name: 'settlementAmount', type: 'number' }, { name: 'unwoundAmount', type: 'number' }];
    case 'EXPIRY':         return [{ name: 'finalSettlement', type: 'number' }];
    default:               return [];
  }
}
