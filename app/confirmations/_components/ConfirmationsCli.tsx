'use client';

import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirmationsStore, type ReconcileResult } from '@/lib/store/confirmationsStore';
import { deriveCashFlow, eventCounterpartyOrAccount } from '@/lib/positions/cashflow';
import { deriveConfirmationStatus } from '@/lib/db/schema';
import type { Event } from '@/lib/db/schema';
import type { EnrichedEvent } from '@/lib/positions/query';
import { cn } from '@/lib/utils';

/** Build the compact per-event briefs the parser needs to reconcile against. */
function buildBriefs(events: EnrichedEvent[], allByPosition: Record<number, Event[]>) {
  return events.map((e) => {
    const params = e.position.params as Record<string, unknown>;
    const payload = e.payload as Record<string, unknown>;
    const cf = deriveCashFlow(e, e.position, allByPosition[e.positionId] ?? []);
    const reference = (payload.contractCode ?? params.contractCode ?? params.isin ?? params.pair ?? payload.externalRef);
    return {
      id:               e.id,
      eventType:        e.eventType,
      effectiveDate:    new Date(e.effectiveAt).toISOString().slice(0, 10),
      positionId:       e.positionId,
      product:          e.position.product,
      counterparty:     eventCounterpartyOrAccount(e.position),
      rateIndex:        typeof params.floatingIndex === 'string' ? params.floatingIndex : undefined,
      notional:         typeof params.notional === 'number' ? params.notional : undefined,
      notionalCurrency: typeof params.currency === 'string' ? params.currency : undefined,
      amount:           cf.absAmount > 0 ? cf.absAmount : undefined,
      amountCurrency:   cf.currency,
      direction:        cf.direction,
      reference:        typeof reference === 'string' ? reference : undefined,
      fixingRate:       typeof payload.fixingRate === 'number' ? payload.fixingRate : undefined,
      status:           deriveConfirmationStatus(e.confirmation),
    };
  });
}

export function ConfirmationsCli() {
  const events             = useConfirmationsStore((s) => s.events);
  const allByPosition      = useConfirmationsStore((s) => s.allEventsByPosition);
  const cliText            = useConfirmationsStore((s) => s.cliText);
  const setCliText         = useConfirmationsStore((s) => s.setCliText);
  const cliBusy            = useConfirmationsStore((s) => s.cliBusy);
  const setCliBusy         = useConfirmationsStore((s) => s.setCliBusy);
  const setFilter          = useConfirmationsStore((s) => s.setFilter);
  const selectMany         = useConfirmationsStore((s) => s.selectMany);
  const setReconciliation  = useConfirmationsStore((s) => s.setReconciliation);
  const clearReconciliation = useConfirmationsStore((s) => s.clearReconciliation);
  const reconciliation     = useConfirmationsStore((s) => s.reconciliation);

  const [files, setFiles]       = useState<File[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const fileInputRef            = useRef<HTMLInputElement>(null);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const next: File[] = [];
    for (const f of Array.from(picked)) {
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        toast.error(`Skipped ${f.name}: only PDFs are supported.`);
        continue;
      }
      next.push(f);
    }
    if (next.length > 0) setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliText.trim() && files.length === 0) return;
    setError(null);
    setCliBusy(true);
    try {
      const briefs = buildBriefs(events, allByPosition);

      let res: Response;
      if (files.length > 0) {
        const form = new FormData();
        form.set('text', cliText);
        form.set('visibleEvents', JSON.stringify(briefs));
        for (const f of files) form.append('files', f);
        res = await fetch('/api/parse-confirmation', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/parse-confirmation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cliText,
            visibleEvents: briefs,
            visibleEventIds: events.map((ev) => ev.id),
          }),
        });
      }

      const parsed = await res.json();
      if (!parsed.ok) {
        setError(parsed.error?.message ?? 'Parse failed');
        return;
      }

      if (parsed.intent === 'FILTER') {
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
      } else if (parsed.intent === 'RECONCILE') {
        const results: Record<number, ReconcileResult> = {};
        const matches: Array<{ eventId: number; status: 'MATCH' | 'MISMATCH'; confidence: number; reasons: string[] }> = parsed.matches ?? [];
        for (const m of matches) {
          results[m.eventId] = { status: m.status, confidence: m.confidence, reasons: m.reasons };
        }
        setReconciliation(results);
        const matchCount    = matches.filter((m) => m.status === 'MATCH').length;
        const mismatchCount = matches.filter((m) => m.status === 'MISMATCH').length;
        toast.success(parsed.summary ?? `Reconciled: ${matchCount} match, ${mismatchCount} mismatch.`);
        setCliText('');
        setFiles([]);
      } else {
        setError('Could not interpret the input. Try restating with explicit fields.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setCliBusy(false);
    }
  }

  const hasReconciliation = Object.keys(reconciliation).length > 0;

  return (
    <div className="px-4 py-3 bg-panel border-t border-border">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, idx) => (
            <span
              key={`${f.name}-${idx}`}
              className="inline-flex items-center gap-1 rounded border border-border-strong bg-panel-elevated px-2 py-0.5 text-xs font-mono"
            >
              <span className="truncate max-w-[200px]" title={f.name}>{f.name}</span>
              <span className="text-muted-foreground">({Math.round(f.size / 1024)} KB)</span>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="ml-0.5 hover:text-invariant"
                aria-label={`Remove ${f.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <span className={cn('text-accent font-mono text-sm select-none', cliBusy && 'live-dot')}>
          {cliBusy ? '◐' : '›'}
        </span>
        <input
          type="text"
          value={cliText}
          onChange={(e) => setCliText(e.target.value)}
          disabled={cliBusy}
          placeholder={
            files.length > 0
              ? 'Optional notes for reconciling the attached PDF(s)…'
              : 'e.g. "show SOFR resets for next week", "select all coupons", or attach a PDF to reconcile'
          }
          className="flex-1 bg-transparent border-none focus:outline-none font-mono text-sm placeholder-muted-foreground"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            // reset so the same file can be re-picked after removal
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={cliBusy}
          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
          aria-label="Attach PDF"
          title="Attach PDF email confirmation"
        >
          <Paperclip size={14} />
        </button>
        <button
          type="submit"
          disabled={cliBusy || (!cliText.trim() && files.length === 0)}
          className="px-3 py-1 text-xs font-medium rounded border border-border-strong hover:bg-panel-elevated disabled:opacity-40"
        >
          {files.length > 0 ? 'Reconcile' : 'Parse'}
        </button>
      </form>
      <div className="mt-2 text-xs flex items-center justify-between gap-3">
        {error && <div className="text-invariant">{error}</div>}
        {!error && (
          <div className="text-muted-foreground italic">
            {events.length} event{events.length === 1 ? '' : 's'} visible.
            {' '}Type to refine filters, or attach PDF emails to reconcile economic details.
          </div>
        )}
        {hasReconciliation && (
          <button
            type="button"
            onClick={clearReconciliation}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear reconciliation
          </button>
        )}
      </div>
    </div>
  );
}
