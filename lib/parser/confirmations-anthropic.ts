import Anthropic from '@anthropic-ai/sdk';
import { CONFIRMATIONS_SYSTEM_PROMPT } from './confirmations-prompt';
import { CONFIRMATIONS_PARSE_TOOLS } from './confirmations-tools';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).');
  }
  _client = new Anthropic();
  return _client;
}

export type ParsedFilter = {
  tool: 'filter_events';
  filter: {
    fromDate?: string;
    toDate?: string;
    eventTypes?: string[];
    counterparty?: string;
    rateIndex?: string;
    confirmationStatus?: 'PENDING' | 'AMOUNT_CONFIRMED' | 'SETTLED';
  };
  confidence: number;
  summary: string;
};

export type ParsedSelect = {
  tool: 'select_events';
  eventIds: number[];
  confidence: number;
  summary: string;
};

export type ReconcileMatch = {
  eventId: number;
  status: 'MATCH' | 'MISMATCH';
  confidence: number;
  reasons: string[];
};

export type ParsedReconcile = {
  tool: 'reconcile_events';
  matches: ReconcileMatch[];
  confidence: number;
  summary: string;
};

export type ParsedConfirmationCmd = ParsedFilter | ParsedSelect | ParsedReconcile;

/** Compact one-line description of an event for the model to reconcile against. */
export type VisibleEventBrief = {
  id: number;
  eventType: string;
  effectiveDate: string;       // YYYY-MM-DD
  positionId: number;
  product: string;
  counterparty?: string;
  rateIndex?: string;
  notional?: number;
  notionalCurrency?: string;
  amount?: number;
  amountCurrency?: string;
  direction?: 'INCOMING' | 'OUTGOING' | 'NONE';
  reference?: string;
  fixingRate?: number;
  status?: string;
};

/** PDF attachment, base64-encoded. */
export type PdfAttachment = {
  filename: string;
  base64: string;
};

function formatVisibleEvents(briefs: VisibleEventBrief[]): string {
  if (briefs.length === 0) return 'VisibleEvents: (none)';
  const lines = briefs.map((e) => {
    const parts: string[] = [
      `id=${e.id}`,
      `type=${e.eventType}`,
      `date=${e.effectiveDate}`,
      `position=#${e.positionId}`,
      `product=${e.product}`,
    ];
    if (e.counterparty) parts.push(`counterparty=${e.counterparty}`);
    if (e.rateIndex)    parts.push(`rateIndex=${e.rateIndex}`);
    if (e.notional !== undefined) parts.push(`notional=${e.notional}${e.notionalCurrency ? ' ' + e.notionalCurrency : ''}`);
    if (e.amount !== undefined)   parts.push(`amount=${e.amount}${e.amountCurrency ? ' ' + e.amountCurrency : ''}`);
    if (e.direction)    parts.push(`direction=${e.direction}`);
    if (e.fixingRate !== undefined) parts.push(`fixingRate=${e.fixingRate}`);
    if (e.reference)    parts.push(`reference=${e.reference}`);
    if (e.status)       parts.push(`status=${e.status}`);
    return '  - ' + parts.join(' ');
  });
  return 'VisibleEvents:\n' + lines.join('\n');
}

export async function parseConfirmationCommand(
  text: string,
  visibleEvents: VisibleEventBrief[] | number[],
  attachments: PdfAttachment[] = [],
): Promise<ParsedConfirmationCmd> {
  const today = new Date().toISOString().slice(0, 10);

  // Backwards-compat: callers without economic detail can pass a plain id list.
  const visibleBlock =
    Array.isArray(visibleEvents) && visibleEvents.every((v): v is number => typeof v === 'number')
      ? `VisibleEventIds: [${visibleEvents.join(', ')}]`
      : formatVisibleEvents(visibleEvents as VisibleEventBrief[]);

  const userText =
    `Today: ${today}\n` +
    `${visibleBlock}\n` +
    `Input: ${text}`;

  const userContent: Anthropic.ContentBlockParam[] = [
    ...attachments.map<Anthropic.ContentBlockParam>((a) => ({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: a.base64 },
      title: a.filename,
    })),
    { type: 'text', text: userText },
  ];

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    system: [
      { type: 'text', text: CONFIRMATIONS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: CONFIRMATIONS_PARSE_TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error('Parser did not return a tool call. Try restating with explicit fields.');
  }

  const input = toolUse.input as Record<string, unknown>;

  if (toolUse.name === 'filter_events') {
    return {
      tool: 'filter_events',
      filter: (input.filter as ParsedFilter['filter']) ?? {},
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      summary: typeof input.summary === 'string' ? input.summary : '',
    };
  }

  if (toolUse.name === 'select_events') {
    const ids = Array.isArray(input.eventIds) ? input.eventIds : [];
    return {
      tool: 'select_events',
      eventIds: ids.filter((n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)),
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      summary: typeof input.summary === 'string' ? input.summary : '',
    };
  }

  if (toolUse.name === 'reconcile_events') {
    const rawMatches = Array.isArray(input.matches) ? input.matches : [];
    const matches: ReconcileMatch[] = [];
    for (const raw of rawMatches) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const eventId = typeof m.eventId === 'number' && Number.isFinite(m.eventId) ? m.eventId : null;
      const status  = m.status === 'MATCH' || m.status === 'MISMATCH' ? m.status : null;
      const confidence = typeof m.confidence === 'number' ? m.confidence : 0;
      const reasons = Array.isArray(m.reasons)
        ? m.reasons.filter((r: unknown): r is string => typeof r === 'string')
        : [];
      if (eventId === null || status === null) continue;
      matches.push({ eventId, status, confidence, reasons });
    }
    return {
      tool: 'reconcile_events',
      matches,
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      summary: typeof input.summary === 'string' ? input.summary : '',
    };
  }

  throw new Error(`Parser returned unknown tool: ${toolUse.name}`);
}
