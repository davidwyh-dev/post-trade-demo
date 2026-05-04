'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirmationsStore } from '@/lib/store/confirmationsStore';
import { deriveCashFlow, eventCounterpartyOrAccount, eventRateIndex } from '@/lib/positions/cashflow';
import { cn, formatNotional } from '@/lib/utils';

type GroupTotals = {
  key: string;             // counterparty/account · currency
  counterparty: string;
  currency: string;
  incoming: number;
  outgoing: number;
  events: number;
  references: Set<string>; // SOFR, ESTR, ...
};

export function EventsSummary({ onReload }: { onReload: () => void }) {
  const events            = useConfirmationsStore((s) => s.events);
  const allByPosition     = useConfirmationsStore((s) => s.allEventsByPosition);
  const selectedIds       = useConfirmationsStore((s) => s.selectedEventIds);
  const clearSelection    = useConfirmationsStore((s) => s.clearSelection);

  const selectedEvents = useMemo(
    () => events.filter((e) => selectedIds.includes(e.id)),
    [events, selectedIds],
  );

  const groups = useMemo<GroupTotals[]>(() => {
    const map = new Map<string, GroupTotals>();
    for (const e of selectedEvents) {
      const fullChain = allByPosition[e.positionId] ?? [];
      const cf = deriveCashFlow(e, e.position, fullChain);
      const ccy = cf.currency ?? '???';
      const ctp = eventCounterpartyOrAccount(e.position);
      const key = `${ctp}|${ccy}`;
      const ref = eventRateIndex(e.position);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          counterparty: ctp,
          currency: ccy,
          incoming: 0,
          outgoing: 0,
          events: 0,
          references: new Set(),
        };
        map.set(key, g);
      }
      g.events += 1;
      if (cf.direction === 'INCOMING') g.incoming += cf.absAmount;
      if (cf.direction === 'OUTGOING') g.outgoing += cf.absAmount;
      if (ref) g.references.add(ref);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.counterparty < b.counterparty ? -1 : a.counterparty > b.counterparty ? 1
      : a.currency.localeCompare(b.currency),
    );
  }, [selectedEvents, allByPosition]);

  // Top-line totals across all selected events. Cross-currency totals don't
  // mean much, so we surface a per-currency net so the operator gets one
  // clean row per currency they're confirming.
  const totalsByCurrency = useMemo(() => {
    const m = new Map<string, { incoming: number; outgoing: number }>();
    for (const g of groups) {
      const t = m.get(g.currency) ?? { incoming: 0, outgoing: 0 };
      t.incoming += g.incoming;
      t.outgoing += g.outgoing;
      m.set(g.currency, t);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [groups]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function bulkConfirm() {
    setBusy(true);
    try {
      const res = await fetch('/api/events/confirm-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventIds: selectedIds,
          amountConfirmed: true,
          reconciled:      true,
          notes:           'bulk confirm',
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error?.message ?? 'Bulk confirm failed');
        return;
      }
      toast.success(`Confirmed ${j.confirmations?.length ?? selectedIds.length} events.`);
      setConfirmOpen(false);
      clearSelection();
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-panel">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Selection summary
          </h2>
          <p className="text-xs text-muted-foreground">
            {selectedIds.length === 0
              ? 'No events selected.'
              : `${selectedIds.length} event${selectedIds.length === 1 ? '' : 's'} grouped by counterparty/account · currency.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearSelection}
            disabled={selectedIds.length === 0}
            className="px-3 py-1 text-xs font-medium rounded border border-border-strong hover:bg-panel-elevated disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={selectedIds.length === 0 || busy}
            className="px-3 py-1 text-xs font-medium rounded border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            Bulk confirm ({selectedIds.length})
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {totalsByCurrency.length > 0 && (
          <div className="px-4 py-2 border-b border-border flex flex-wrap gap-3 text-xs">
            {totalsByCurrency.map(([ccy, t]) => (
              <div key={ccy} className="rounded border border-border bg-panel-elevated px-2 py-1">
                <span className="text-muted-foreground mr-2">{ccy} net</span>
                <span className="text-buy font-mono">+{formatNotional(t.incoming)}</span>
                <span className="text-muted-foreground mx-1">·</span>
                <span className="text-sell font-mono">-{formatNotional(t.outgoing)}</span>
              </div>
            ))}
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="bg-panel text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Counterparty / Account</th>
              <th className="text-left px-3 py-2 font-medium w-16">Ccy</th>
              <th className="text-right px-3 py-2 font-medium">Gross incoming</th>
              <th className="text-right px-3 py-2 font-medium">Gross outgoing</th>
              <th className="text-right px-3 py-2 font-medium w-16">Events</th>
              <th className="text-left px-3 py-2 font-medium">References</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-6 text-xs italic">
                  Select events to see totals.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.key} className="border-b border-border">
                <td className="px-3 py-2 font-mono text-xs">{g.counterparty}</td>
                <td className="px-3 py-2 font-mono text-xs">{g.currency}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {g.incoming > 0
                    ? <span className="text-buy">+{formatNotional(g.incoming)}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {g.outgoing > 0
                    ? <span className="text-sell">-{formatNotional(g.outgoing)}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{g.events}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {g.references.size === 0 ? '—' : Array.from(g.references).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[10px] text-muted-foreground italic">
          Indicative amounts. RATE_RESET cash legs are estimated (notional × fixing × ¼ year); actual settle on COUPON.
        </p>
      </div>

      {confirmOpen && (
        <BulkConfirmModal
          count={selectedIds.length}
          onCancel={() => !busy && setConfirmOpen(false)}
          onConfirm={bulkConfirm}
          busy={busy}
        />
      )}
    </div>
  );
}

function BulkConfirmModal({
  count, busy, onConfirm, onCancel,
}: { count: number; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[420px] max-w-[92vw] rounded-lg border border-border bg-panel-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Bulk confirm {count} event{count === 1 ? '' : 's'}?</h3>
        </header>
        <div className="px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p>This will set <span className="text-foreground">amount confirmed</span> and <span className="text-foreground">reconciled</span> to true on all selected events.</p>
          <p>You can revert each one later from the Event Details panel.</p>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium rounded border border-border-strong hover:bg-panel disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded border border-accent/40 bg-accent/15 text-accent',
              !busy && 'hover:bg-accent/25',
              busy && 'opacity-50 cursor-wait',
            )}
          >
            {busy ? 'Confirming…' : `Confirm ${count}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
