'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirmationsStore } from '@/lib/store/confirmationsStore';
import { cn } from '@/lib/utils';

export function ConfirmationsCli() {
  const events       = useConfirmationsStore((s) => s.events);
  const cliText      = useConfirmationsStore((s) => s.cliText);
  const setCliText   = useConfirmationsStore((s) => s.setCliText);
  const cliBusy      = useConfirmationsStore((s) => s.cliBusy);
  const setCliBusy   = useConfirmationsStore((s) => s.setCliBusy);
  const setFilter    = useConfirmationsStore((s) => s.setFilter);
  const selectMany   = useConfirmationsStore((s) => s.selectMany);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliText.trim()) return;
    setError(null);
    setCliBusy(true);
    try {
      const visibleEventIds = events.map((ev) => ev.id);
      const res = await fetch('/api/parse-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cliText, visibleEventIds }),
      });
      const parsed = await res.json();
      if (!parsed.ok) {
        setError(parsed.error?.message ?? 'Parse failed');
        return;
      }

      if (parsed.intent === 'FILTER') {
        // Server-side date range comes from filter.fromDate/toDate; the rest are
        // applied client-side via applyClientFilter(). Setting them all here.
        setFilter(parsed.filter ?? {});
        toast.info(parsed.summary ?? 'Filter updated.');
        setCliText('');
      } else if (parsed.intent === 'SELECT') {
        const ids: number[] = parsed.eventIds ?? [];
        if (ids.length === 0) {
          setError('The parser returned no event IDs.');
          return;
        }
        selectMany(ids, /* replace */ true);
        toast.success(parsed.summary ?? `Selected ${ids.length} events.`);
        setCliText('');
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
    <div className="px-4 py-3 bg-panel border-t border-border">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <span className={cn('text-accent font-mono text-sm select-none', cliBusy && 'live-dot')}>
          {cliBusy ? '◐' : '›'}
        </span>
        <input
          type="text"
          value={cliText}
          onChange={(e) => setCliText(e.target.value)}
          disabled={cliBusy}
          placeholder='e.g. "show SOFR resets for next week" or "select all unreconciled coupons with JPM"'
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
        {!error && (
          <div className="text-muted-foreground italic">
            Filters: {events.length} events visible. Type to refine the date range, type, counterparty, rate index, or status.
          </div>
        )}
      </div>
    </div>
  );
}
