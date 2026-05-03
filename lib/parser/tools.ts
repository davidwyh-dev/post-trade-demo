// Tool definitions passed to Claude. We intentionally use loose `params`/`payload`
// schemas (the model fills them in based on the system prompt) and validate
// strictly server-side via the Zod schemas in lib/positions/params.
//
// The strong server-side validation is what makes this safe. The benefit is a
// much smaller, more cacheable tool definition (and no JSON-Schema-vs-Zod
// discriminated-union gotchas inside Anthropic's input_schema).

export const PARSE_TOOLS = [
  {
    name: 'propose_create_position',
    description:
      'Propose creating a new position from the parsed trade. Use when the trader is opening a new trade. The `params` field must conform to the product-specific schema described in the system prompt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product: {
          type: 'string',
          enum: ['IRS', 'FUTURE', 'TREASURY', 'FX'],
          description: 'The product type. Must match the params.product field.',
        },
        params: {
          type: 'object',
          description:
            'Full position parameters per the product. MUST include `product` matching the top-level product, and all required fields from the relevant product schema in the system prompt.',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Parser confidence in the extraction. See system prompt for the rubric.',
        },
        summary: {
          type: 'string',
          description: 'One-sentence plain-English summary of the trade.',
        },
      },
      required: ['product', 'params', 'confidence', 'summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_event',
    description:
      'Propose appending a lifecycle event (TERMINATION, AMEND, RATE_RESET, COUPON, NOVATION, ROLL, EXPIRY, CANCEL, PARTIAL_UNWIND) to an existing position. Use the contextPositionId from the user message when the trader does not name a position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        eventType: {
          type: 'string',
          enum: [
            'AMEND','RATE_RESET','COUPON','NOVATION','TERMINATION',
            'ROLL','EXPIRY','CANCEL','PARTIAL_UNWIND',
          ],
        },
        positionId: {
          type: ['integer', 'null'],
          description:
            'The position ID this event targets. Set to the contextPositionId from the user message when the input does not name one. If neither the input nor the context provides a position, set null and lower confidence.',
        },
        payload: {
          type: 'object',
          description:
            'Event-specific fields. See the system prompt for the exact shape per event type.',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        summary: {
          type: 'string',
          description: 'One-sentence plain-English summary of the event.',
        },
      },
      required: ['eventType', 'payload', 'confidence', 'summary'],
      additionalProperties: false,
    },
  },
];
