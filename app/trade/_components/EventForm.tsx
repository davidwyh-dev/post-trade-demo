'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTradeStore } from '@/lib/store/tradeStore';

type Props = {
  positionId: number;
  eventType: string;
  prefill?: Record<string, unknown>;
};

const inputCls =
  'bg-panel-elevated border border-border rounded px-2 py-1 text-sm font-mono ' +
  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function EventForm({ positionId, eventType, prefill }: Props) {
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const setEvents = useTradeStore((s) => s.setEvents);
  const setPositions = useTradeStore((s) => s.setPositions);
  const [payload, setPayload] = useState<Record<string, unknown>>(() => initialPayload(eventType, prefill));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/positions/${positionId}/events/${eventType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error?.message ?? 'Failed to append event');
        return;
      }
      toast.success(`${eventType} appended.`);
      // Refresh both events and positions (status may have flipped).
      const [evRes, posRes] = await Promise.all([
        fetch(`/api/positions/${positionId}`).then((r) => r.json()),
        fetch('/api/positions').then((r) => r.json()),
      ]);
      setEvents(evRes.events ?? []);
      setPositions(posRes.positions ?? []);
      setDetails({ kind: 'view', positionId });
    } finally {
      setBusy(false);
    }
  }

  const fields = FIELDS_BY_EVENT[eventType] ?? [];
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <Field key={f.name} label={f.label}>
            <input
              type={f.type ?? 'text'}
              value={(payload[f.name] as string | number) ?? ''}
              onChange={(e) => {
                const v = f.type === 'number' ? Number(e.target.value) : e.target.value;
                setPayload((p) => ({ ...p, [f.name]: v }));
              }}
              step={f.type === 'number' ? 'any' : undefined}
              className={inputCls}
            />
          </Field>
        ))}
      </div>
      <div className="flex gap-2 pt-2 border-t border-border">
        <button type="submit" disabled={busy} className="px-3 py-1.5 text-xs font-medium rounded bg-accent text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-40">
          {busy ? 'Appending…' : 'Append event'}
        </button>
        <button type="button" onClick={() => setDetails({ kind: 'view', positionId })} className="px-3 py-1.5 text-xs font-medium rounded border border-border-strong hover:bg-panel-elevated">
          Cancel
        </button>
      </div>
    </form>
  );
}

type FieldSpec = { name: string; label: string; type?: 'text' | 'number' | 'date' };

const FIELDS_BY_EVENT: Record<string, FieldSpec[]> = {
  AMEND: [
    { name: 'newNotional', label: 'New notional', type: 'number' },
    { name: 'newRate',     label: 'New rate',     type: 'number' },
    { name: 'newQuantity', label: 'New quantity', type: 'number' },
    { name: 'reason',      label: 'Reason' },
  ],
  RATE_RESET: [
    { name: 'resetDate',        label: 'Reset date',        type: 'date' },
    { name: 'fixingRate',       label: 'Fixing rate (%)',   type: 'number' },
    { name: 'accrualStartDate', label: 'Accrual start',     type: 'date' },
    { name: 'accrualEndDate',   label: 'Accrual end',       type: 'date' },
  ],
  COUPON: [
    { name: 'paymentDate', label: 'Payment date', type: 'date' },
    { name: 'amount',      label: 'Amount',       type: 'number' },
    { name: 'currency',    label: 'Currency' },
  ],
  NOVATION: [
    { name: 'fromCounterparty', label: 'From counterparty' },
    { name: 'toCounterparty',   label: 'To counterparty' },
    { name: 'novationDate',     label: 'Novation date', type: 'date' },
  ],
  TERMINATION: [
    { name: 'terminationDate',  label: 'Termination date', type: 'date' },
    { name: 'settlementAmount', label: 'Settlement amount', type: 'number' },
    { name: 'currency',         label: 'Currency' },
  ],
  ROLL: [
    { name: 'fromValueDate', label: 'From value date', type: 'date' },
    { name: 'toValueDate',   label: 'To value date',   type: 'date' },
    { name: 'fromRate',      label: 'From rate',       type: 'number' },
    { name: 'toRate',        label: 'To rate',         type: 'number' },
  ],
  EXPIRY: [
    { name: 'expiryDate',         label: 'Expiry date',           type: 'date' },
    { name: 'finalSettlement',    label: 'Final settlement',      type: 'number' },
    { name: 'finalSettlementCcy', label: 'Final settlement ccy' },
  ],
  CANCEL: [
    { name: 'reason', label: 'Reason' },
  ],
  PARTIAL_UNWIND: [
    { name: 'unwoundAmount',    label: 'Unwound amount',    type: 'number' },
    { name: 'currency',         label: 'Currency' },
    { name: 'settlementAmount', label: 'Settlement amount', type: 'number' },
  ],
};

function initialPayload(eventType: string, prefill?: Record<string, unknown>): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const defaults: Record<string, unknown> = {};
  for (const f of FIELDS_BY_EVENT[eventType] ?? []) {
    if (f.type === 'date') defaults[f.name] = today;
  }
  return { ...defaults, ...(prefill ?? {}) };
}
