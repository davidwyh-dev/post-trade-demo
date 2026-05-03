'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTradeStore } from '@/lib/store/tradeStore';
import { summarizePosition } from '@/lib/positions/summary';
import { cn } from '@/lib/utils';

export function TradeCli() {
  const positions = useTradeStore((s) => s.positions);
  const events = useTradeStore((s) => s.events);
  const selectedId = useTradeStore((s) => s.selectedPositionId);
  const cliText = useTradeStore((s) => s.cliText);
  const setCliText = useTradeStore((s) => s.setCliText);
  const cliBusy = useTradeStore((s) => s.cliBusy);
  const setCliBusy = useTradeStore((s) => s.setCliBusy);
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const select = useTradeStore((s) => s.selectPosition);
  const [error, setError] = useState<string | null>(null);

  const selected = positions.find((p) => p.id === selectedId);
  const summary = useMemo(
    () => (selected ? summarizePosition(selected, events) : null),
    [selected, events],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliText.trim()) return;
    setError(null);
    setCliBusy(true);
    try {
      const parseRes = await fetch('/api/parse-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cliText, contextPositionId: selectedId }),
      });
      const parsed = await parseRes.json();
      if (!parsed.ok) {
        setError(parsed.error?.message ?? 'Parse failed');
        return;
      }

      // Two response shapes from /api/parse-trade:
      //   { ok, intent: 'CREATE', product, params, suggestedPositionId, summary, confidence }
      //   { ok, intent: 'EVENT',  positionId, eventType, payload, summary, confidence }
      if (parsed.intent === 'EVENT' && parsed.positionId) {
        select(parsed.positionId);
        setDetails({ kind: 'event', positionId: parsed.positionId, eventType: parsed.eventType, prefill: parsed.payload });
        toast.info(parsed.summary ?? `Drafted ${parsed.eventType} on position #${parsed.positionId}.`);
      } else if (parsed.intent === 'CREATE') {
        if (parsed.suggestedPositionId && parsed.confidence >= 0.85) {
          select(parsed.suggestedPositionId);
          setDetails({ kind: 'view', positionId: parsed.suggestedPositionId });
          toast.success(`Matched existing position #${parsed.suggestedPositionId}.`);
        } else {
          select(null);
          setDetails({ kind: 'create', prefill: parsed.params });
          toast.info('No match found. Pre-filled the new-position form.');
        }
      } else {
        setError('Could not interpret the input. Try restating with explicit fields.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setCliBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 bg-panel">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <span className={cn('text-accent font-mono text-sm select-none', cliBusy && 'live-dot')}>
          {cliBusy ? '◐' : '›'}
        </span>
        <input
          type="text"
          autoFocus
          value={cliText}
          onChange={(e) => setCliText(e.target.value)}
          disabled={cliBusy}
          placeholder='e.g. "buy 100mm 5y USD pay fixed at 4.25 vs SOFR JPM"  or  "terminate"'
          className="flex-1 bg-transparent border-none focus:outline-none font-mono text-sm placeholder-muted-foreground"
        />
        <button
          type="submit"
          disabled={cliBusy || !cliText.trim()}
          className="px-3 py-1 text-xs font-medium rounded border border-border-strong hover:bg-panel-elevated disabled:opacity-40"
        >
          Parse
        </button>
      </form>

      <div className="mt-2 text-xs">
        {error && <div className="text-invariant">{error}</div>}
        {!error && summary && (
          <div className="text-muted-foreground">
            <span className="text-foreground/80">Selected:</span> {summary}
          </div>
        )}
        {!error && !summary && (
          <div className="text-muted-foreground italic">
            No position selected. Type a trade to create or match one.
          </div>
        )}
      </div>
    </div>
  );
}
