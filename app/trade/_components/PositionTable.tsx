'use client';

import { useTradeStore } from '@/lib/store/tradeStore';
import type { Position } from '@/lib/db/schema';
import { cn, formatNotional } from '@/lib/utils';

const PRODUCT_LABEL: Record<string, string> = {
  IRS: 'Swap',
  FUTURE: 'Future',
  TREASURY: 'Bond',
  FX: 'FX',
};

const STATUS_CLASS: Record<string, string> = {
  OPEN: 'bg-status-open/15 text-status-open',
  CLOSED: 'bg-status-closed/15 text-status-closed',
  TERMINATED: 'bg-status-terminated/15 text-status-terminated',
};

export function PositionTable() {
  const positions = useTradeStore((s) => s.positions);
  const selectedId = useTradeStore((s) => s.selectedPositionId);
  const select = useTradeStore((s) => s.selectPosition);
  const setDetails = useTradeStore((s) => s.setDetailsMode);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-panel">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Positions
          </h2>
          <p className="text-xs text-muted-foreground">
            {positions.length} positions · click a row to inspect
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            select(null);
            setDetails({ kind: 'create' });
          }}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-border-strong hover:bg-panel-elevated transition-colors"
        >
          + New position
        </button>
      </header>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-12">#</th>
              <th className="text-left px-4 py-2 font-medium">Product</th>
              <th className="text-left px-4 py-2 font-medium">Summary</th>
              <th className="text-left px-4 py-2 font-medium">Counterparty</th>
              <th className="text-right px-4 py-2 font-medium">Notional</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Opened</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-6 text-xs">
                  No positions. Type a trade in the CLI below or click "+ New position".
                </td>
              </tr>
            )}
            {positions.map((p) => {
              const r = renderRow(p);
              return (
                <tr
                  key={p.id}
                  onClick={() => select(p.id)}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-panel-elevated transition-colors',
                    selectedId === p.id && 'bg-accent/15 hover:bg-accent/20',
                  )}
                >
                  <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{p.id}</td>
                  <td className="px-4 py-2 font-medium">{PRODUCT_LABEL[p.product] ?? p.product}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.summary}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.counterparty ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{r.notional ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', STATUS_CLASS[p.status])}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(p.openedAt).toISOString().slice(0, 10)}
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

function renderRow(p: Position): {
  summary: string;
  counterparty: string | null;
  notional: string | null;
} {
  const params = p.params as Record<string, unknown>;
  switch (p.product) {
    case 'IRS': {
      const dir = params.payReceive === 'PAY_FIXED' ? 'Pay' : 'Recv';
      const tenor = monthsBetween(params.effectiveDate as string, params.maturityDate as string);
      return {
        summary: `${dir} ${(params.fixedRate as number).toFixed(3)}% ${tenorLabel(tenor)} ${params.currency} vs ${params.floatingIndex}`,
        counterparty: String(params.counterparty),
        notional: formatNotional(params.notional as number, params.currency as string),
      };
    }
    case 'FUTURE':
      return {
        summary: `${String(params.contractCode)} (${String(params.exchange)})${params.description ? ' — ' + params.description : ''}`,
        counterparty: null,
        notional: `${(params.initialContracts as number).toLocaleString()} contracts`,
      };
    case 'TREASURY':
      return {
        summary: `${String(params.issuer)} ${(params.coupon as number).toFixed(3)}% ${String(params.maturityDate).slice(0, 7)} (${String(params.side)})`,
        counterparty: null,
        notional: formatNotional(params.initialFaceAmount as number, params.currency as string),
      };
    case 'FX': {
      const swap = params.kind === 'SWAP'
        ? `→ ${String(params.farValueDate)}`
        : '';
      return {
        summary: `${String(params.kind)} ${String(params.pair)} @ ${(params.rate as number).toFixed(4)} val ${String(params.valueDate)} ${swap}`,
        counterparty: String(params.counterparty),
        notional: formatNotional(params.notionalBase as number, params.baseCurrency as string),
      };
    }
    default:
      return { summary: JSON.stringify(params), counterparty: null, notional: null };
  }
}

function monthsBetween(from: string, to: string): number {
  const [yf, mf] = from.split('-').map(Number);
  const [yt, mt] = to.split('-').map(Number);
  return (yt - yf) * 12 + (mt - mf);
}

function tenorLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12}Y`;
  return `${months}M`;
}
