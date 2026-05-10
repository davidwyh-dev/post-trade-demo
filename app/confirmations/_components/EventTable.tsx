'use client';

import { useMemo } from 'react';
import { useConfirmationsStore, applyClientFilter } from '@/lib/store/confirmationsStore';
import { deriveConfirmationStatus } from '@/lib/db/schema';
import type { ConfirmationStatus } from '@/lib/db/schema';
import { cn, formatNotional } from '@/lib/utils';
import { eventCounterpartyOrAccount, deriveCashFlow } from '@/lib/positions/cashflow';

const STATUS_CLASS: Record<ConfirmationStatus, string> = {
  PENDING:          'bg-status-terminated/15 text-status-terminated',
  AMOUNT_CONFIRMED: 'bg-event-amend/15 text-event-amend',
  SETTLED:          'bg-status-open/15 text-status-open',
};

/** Confidence floor below which we don't tint the row. The model is told this
 * threshold; rows above it carry visual weight, rows below stay neutral. */
const RECONCILE_CONFIDENCE_THRESHOLD = 0.85;

export function EventTable({ onReload }: { onReload: () => void }) {
  const events             = useConfirmationsStore((s) => s.events);
  const allByPosition      = useConfirmationsStore((s) => s.allEventsByPosition);
  const filter             = useConfirmationsStore((s) => s.filter);
  const setFilter          = useConfirmationsStore((s) => s.setFilter);
  const selectedIds        = useConfirmationsStore((s) => s.selectedEventIds);
  const toggleSelect       = useConfirmationsStore((s) => s.toggleSelect);
  const selectAllVisible   = useConfirmationsStore((s) => s.selectAllVisible);
  const clearSelection     = useConfirmationsStore((s) => s.clearSelection);
  const loading            = useConfirmationsStore((s) => s.loading);
  const reconciliation     = useConfirmationsStore((s) => s.reconciliation);

  const filtered = useMemo(() => applyClientFilter(events, filter), [events, filter]);
  const allChecked = filtered.length > 0 && selectedIds.length === filtered.length;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-panel">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Events
          </h2>
          <p className="text-xs text-muted-foreground">
            {filtered.length} event{filtered.length === 1 ? '' : 's'} · {selectedIds.length} selected
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-muted-foreground">
            From
            <input
              type="date"
              value={filter.fromDate}
              onChange={(e) => setFilter({ fromDate: e.target.value })}
              className="bg-panel-elevated border border-border rounded px-1.5 py-0.5 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            To
            <input
              type="date"
              value={filter.toDate}
              onChange={(e) => setFilter({ toDate: e.target.value })}
              className="bg-panel-elevated border border-border rounded px-1.5 py-0.5 font-mono text-xs"
            />
          </label>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            className="px-2 py-0.5 border border-border-strong rounded hover:bg-panel-elevated disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Reload'}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <tr>
              <th className="px-3 py-2 w-10 text-left">
                <input
                  type="checkbox"
                  aria-label="Select all visible events"
                  checked={allChecked}
                  onChange={() => allChecked ? clearSelection() : selectAllVisible()}
                />
              </th>
              <th className="text-left px-3 py-2 font-medium w-12">#</th>
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Position</th>
              <th className="text-left px-3 py-2 font-medium">Counterparty</th>
              <th className="text-right px-3 py-2 font-medium">Amount</th>
              <th className="text-left px-3 py-2 font-medium">Direction</th>
              <th className="text-left px-3 py-2 font-medium">Reference</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-muted-foreground py-6 text-xs">
                  No events for {filter.fromDate} – {filter.toDate}.
                </td>
              </tr>
            )}
            {filtered.map((e) => {
              const params = e.position.params as Record<string, unknown>;
              const fullChain = allByPosition[e.positionId] ?? [];
              const cf = deriveCashFlow(e, e.position, fullChain);
              const status = deriveConfirmationStatus(e.confirmation);
              const checked = selectedIds.includes(e.id);
              const recon = reconciliation[e.id];
              const tinted = recon && recon.confidence >= RECONCILE_CONFIDENCE_THRESHOLD;
              const tintTitle = recon && recon.reasons.length > 0
                ? `${recon.status} (${Math.round(recon.confidence * 100)}%)\n• ${recon.reasons.join('\n• ')}`
                : undefined;
              return (
                <tr
                  key={e.id}
                  onClick={() => toggleSelect(e.id)}
                  title={tintTitle}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-panel-elevated transition-colors',
                    tinted && recon.status === 'MATCH'    && 'bg-status-open/15 hover:bg-status-open/25',
                    tinted && recon.status === 'MISMATCH' && 'bg-invariant/15 hover:bg-invariant/25',
                    checked && 'bg-accent/15 hover:bg-accent/20',
                  )}
                >
                  <td className="px-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(e.id)}
                      aria-label={`Select event ${e.id}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{e.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {new Date(e.effectiveAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 font-medium">{e.eventType.replaceAll('_', ' ')}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    #{e.positionId} · {e.position.product}
                    {params.currency ? ` · ${params.currency}` : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{eventCounterpartyOrAccount(e.position)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {cf.absAmount > 0 ? formatNotional(cf.absAmount, cf.currency) : '—'}
                    {cf.amended && <span className="ml-1 text-event-amend" title="Amended">●</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {cf.direction === 'INCOMING' && <span className="text-buy">in</span>}
                    {cf.direction === 'OUTGOING' && <span className="text-sell">out</span>}
                    {cf.direction === 'NONE' && <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {String(params.floatingIndex ?? params.contractCode ?? params.isin ?? params.pair ?? '—')}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', STATUS_CLASS[status])}>
                      {status.replaceAll('_', ' ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
