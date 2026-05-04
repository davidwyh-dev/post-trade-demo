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

export type ParsedConfirmationCmd = ParsedFilter | ParsedSelect;

export async function parseConfirmationCommand(
  text: string,
  visibleEventIds: number[],
): Promise<ParsedConfirmationCmd> {
  const today = new Date().toISOString().slice(0, 10);
  const userMessage =
    `Today: ${today}\n` +
    `VisibleEventIds: [${visibleEventIds.join(', ')}]\n` +
    `Input: ${text}`;

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: [
      { type: 'text', text: CONFIRMATIONS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: CONFIRMATIONS_PARSE_TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: userMessage }],
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

  throw new Error(`Parser returned unknown tool: ${toolUse.name}`);
}
