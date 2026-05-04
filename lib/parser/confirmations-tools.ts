// Tool definitions for the Confirmations CLI parser. Loose schemas; the
// server validates the parsed structure with Zod before consuming it.

export const CONFIRMATIONS_PARSE_TOOLS = [
  {
    name: 'filter_events',
    description:
      'Update the Confirmations page filters. Use when the operator describes which events to look at (date range, type, counterparty, rate index, status).',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'object',
          description: 'Filter fields. Only include fields the operator clearly intends.',
          properties: {
            fromDate:           { type: 'string', description: 'YYYY-MM-DD' },
            toDate:             { type: 'string', description: 'YYYY-MM-DD' },
            eventTypes: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['AMEND','RATE_RESET','COUPON','NOVATION','TERMINATION','ROLL','EXPIRY','CANCEL','PARTIAL_UNWIND'],
              },
            },
            counterparty:        { type: 'string', description: 'Canonical counterparty code, e.g. JPM, GS, MS' },
            rateIndex:           { type: 'string', description: 'SOFR, ESTR, SONIA, ...' },
            confirmationStatus:  { type: 'string', enum: ['PENDING', 'AMOUNT_CONFIRMED', 'SETTLED'] },
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        summary:    { type: 'string' },
      },
      required: ['filter', 'confidence', 'summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'select_events',
    description: 'Select specific events by ID. Use when the operator names events explicitly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        eventIds:   { type: 'array', items: { type: 'integer' } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        summary:    { type: 'string' },
      },
      required: ['eventIds', 'confidence', 'summary'],
      additionalProperties: false,
    },
  },
];
