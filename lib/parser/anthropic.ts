import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt';
import { PARSE_TOOLS } from './tools';

// One module-scoped client. SDK reads ANTHROPIC_API_KEY automatically.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).');
  }
  _client = new Anthropic();
  return _client;
}

export type ParsedCreate = {
  tool: 'propose_create_position';
  product: 'IRS' | 'FUTURE' | 'TREASURY' | 'FX';
  params: Record<string, unknown>;
  confidence: number;
  summary: string;
};

export type ParsedEvent = {
  tool: 'propose_event';
  eventType: string;
  positionId: number | null;
  payload: Record<string, unknown>;
  confidence: number;
  summary: string;
};

export type ParseResult = ParsedCreate | ParsedEvent;

export async function parseTrade(text: string, contextPositionId: number | null): Promise<ParseResult> {
  const today = new Date().toISOString().slice(0, 10);
  const userMessage =
    `Today: ${today}\n` +
    `ContextPositionId: ${contextPositionId ?? 'none'}\n` +
    `Input: ${text}`;

  // Caching: tools render before system before messages. Putting cache_control
  // on the system block caches tools + system together. Today's date + user
  // input live in the (volatile) message body, after the breakpoint.
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    // SDK type for tools is structurally compatible with our literal; cast keeps the file lean.
    tools: PARSE_TOOLS as unknown as Anthropic.Tool[],
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

  if (toolUse.name === 'propose_create_position') {
    return {
      tool: 'propose_create_position',
      product: input.product as ParsedCreate['product'],
      params: (input.params as Record<string, unknown>) ?? {},
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      summary: typeof input.summary === 'string' ? input.summary : '',
    };
  }

  if (toolUse.name === 'propose_event') {
    return {
      tool: 'propose_event',
      eventType: String(input.eventType ?? ''),
      positionId:
        typeof input.positionId === 'number' ? input.positionId : null,
      payload: (input.payload as Record<string, unknown>) ?? {},
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      summary: typeof input.summary === 'string' ? input.summary : '',
    };
  }

  throw new Error(`Parser returned unknown tool: ${toolUse.name}`);
}
