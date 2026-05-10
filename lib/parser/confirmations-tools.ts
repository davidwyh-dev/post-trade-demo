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
  {
    name: 'reconcile_events',
    description:
      'Compare economic details extracted from one or more attached PDF documents (typically counterparty confirmation emails) against the visible events. Use when PDF attachments are present. Emit one entry per visible event you can form an opinion on; omit events the documents do not address. Only emit MATCH or MISMATCH when the comparison is unambiguous on at least one key economic field; use confidence to express certainty.',
    input_schema: {
      type: 'object' as const,
      properties: {
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventId:    { type: 'integer', description: 'ID from the VisibleEvents block.' },
              status:     { type: 'string', enum: ['MATCH', 'MISMATCH'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              reasons: {
                type: 'array',
                description: 'Short, human-readable bullet points: which fields agreed/disagreed and the values seen. One sentence each.',
                items: { type: 'string' },
              },
            },
            required: ['eventId', 'status', 'confidence', 'reasons'],
            additionalProperties: false,
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Overall confidence across the document set.' },
        summary:    { type: 'string', description: 'One-sentence plain-English summary of the reconciliation outcome.' },
      },
      required: ['matches', 'confidence', 'summary'],
      additionalProperties: false,
    },
  },
];
