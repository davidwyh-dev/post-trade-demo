import { z } from 'zod';
import { G10_CURRENCIES, FX_KINDS } from '@/lib/constants';

// FX trade. SPOT, FORWARD, or SWAP (near + far leg). Each ticket is its own
// position — rate is event-level, not part of the key, since a desk treats
// distinct trades on the same pair/value-date as separate positions.
//
// FX SWAP encodes both legs in a single position; far-leg fields are required
// only when kind === 'SWAP'.
export const FxParams = z.object({
  product:       z.literal('FX'),
  pair:          z.string().regex(/^[A-Z]{3}\/[A-Z]{3}$/),  // 'EUR/USD'
  baseCurrency:  z.enum(G10_CURRENCIES),
  quoteCurrency: z.enum(G10_CURRENCIES),
  kind:          z.enum(FX_KINDS),
  valueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),     // near-leg value date
  notionalBase:  z.number().positive(),
  rate:          z.number().positive(),                       // near-leg rate
  counterparty:  z.string().min(1),
  // SWAP-only fields:
  farValueDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  farRate:       z.number().positive().optional(),
}).refine(
  (v) => v.kind !== 'SWAP' || (v.farValueDate !== undefined && v.farRate !== undefined),
  { message: 'FX SWAP requires farValueDate and farRate' },
);

export type FxParams = z.infer<typeof FxParams>;

export const FX_KEY_FIELDS = [
  'pair','valueDate','counterparty','kind',
] as const satisfies readonly (keyof FxParams)[];
