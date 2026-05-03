import { z } from 'zod';
import { FUTURES_EXCHANGES } from '@/lib/constants';

// Listed futures contract. contractCode is the exchange ticker (e.g. FVH6 =
// 5Y US Note March 2026 on CBOT). Contracts are amended via AMEND/EXPIRY/ROLL.
//
// Position identity: contractCode + exchange + account. Each ticket aggregates
// net contracts via events; quantity itself isn't part of the key.
export const FutureParams = z.object({
  product:      z.literal('FUTURE'),
  contractCode: z.string().min(2),                  // 'FVH6', 'EDU6', 'FGBL Z6'
  exchange:     z.enum(FUTURES_EXCHANGES),
  account:      z.string().min(1),                  // broker account / book
  initialContracts: z.number().int(),               // signed: +long, -short
  expiryDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  multiplier:   z.number().positive(),              // e.g. 1000 for 5Y note
  tickSize:     z.number().positive(),              // minimum price increment
  description:  z.string().optional(),              // '5Y US Treasury Note Mar 2026'
});

export type FutureParams = z.infer<typeof FutureParams>;

export const FUTURE_KEY_FIELDS = [
  'contractCode','exchange','account',
] as const satisfies readonly (keyof FutureParams)[];
