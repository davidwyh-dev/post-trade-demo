import type { Position, Event } from '@/lib/db/schema';
import { formatNotional } from '@/lib/utils';

/**
 * Plain-language summary of a position + its event chain. Shown beneath the
 * Trade CLI input so a trader can read at a glance what they're looking at.
 */
export function summarizePosition(position: Position, events: Event[]): string {
  const head = describeHead(position);
  const tail = describeEvents(events);
  return tail ? `${head}. ${tail}.` : `${head}.`;
}

function describeHead(p: Position): string {
  const params = p.params as Record<string, unknown>;
  switch (p.product) {
    case 'IRS': {
      const dir = params.payReceive === 'PAY_FIXED' ? 'pay-fixed' : 'receive-fixed';
      const tenor = monthsBetween(params.effectiveDate as string, params.maturityDate as string);
      return `${formatNotional(params.notional as number, params.currency as string)} ${dir} ${tenorLabel(tenor)} swap @ ${(params.fixedRate as number).toFixed(3)}% vs ${params.floatingIndex} with ${params.counterparty} (${p.status.toLowerCase()})`;
    }
    case 'FUTURE':
      return `${(params.initialContracts as number).toLocaleString()} contracts of ${params.contractCode} on ${params.exchange}, expiring ${params.expiryDate} (${p.status.toLowerCase()})`;
    case 'TREASURY':
      return `${(params.side as string).toLowerCase()} ${formatNotional(params.initialFaceAmount as number, params.currency as string)} of ${params.issuer} ${(params.coupon as number).toFixed(3)}% ${params.maturityDate} (${p.status.toLowerCase()})`;
    case 'FX': {
      const swap = params.kind === 'SWAP' ? ` / far leg ${params.farValueDate} @ ${params.farRate}` : '';
      return `${(params.kind as string).toLowerCase()} ${params.pair} ${formatNotional(params.notionalBase as number, params.baseCurrency as string)} @ ${(params.rate as number).toFixed(4)} value ${params.valueDate}${swap}, with ${params.counterparty} (${p.status.toLowerCase()})`;
    }
    default:
      return `${p.product} position #${p.id} (${p.status.toLowerCase()})`;
  }
}

function describeEvents(events: Event[]): string {
  if (events.length <= 1) return events.length === 1 ? 'Opened with NEW only' : '';
  const after = events.slice(1);
  const counts: Record<string, number> = {};
  for (const e of after) counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => v === 1 ? k.toLowerCase().replaceAll('_', ' ') : `${v}× ${k.toLowerCase().replaceAll('_', ' ')}`);
  const last = events[events.length - 1];
  // effectiveAt is typed Date by Drizzle but arrives as ISO string over the wire.
  const date = String(last.effectiveAt as unknown).slice(0, 10);
  return `${after.length} events appended (${parts.join(', ')}); last event was ${last.eventType.toLowerCase().replaceAll('_', ' ')} on ${date}`;
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
