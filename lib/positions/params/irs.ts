import { z } from 'zod';
import { G10_CURRENCIES, FLOATING_INDICES, PAY_RECEIVE } from '@/lib/constants';

// Interest Rate Swap. A vanilla single-currency fixed-vs-float swap.
//
// Position identity (KEY_FIELDS): everything that defines the swap's
// economic shape EXCEPT notional, which can be amended via AMEND or
// PARTIAL_UNWIND events without spawning a new position.
export const IrsParams = z.object({
  product:           z.literal('IRS'),
  currency:          z.enum(G10_CURRENCIES),
  notional:          z.number().positive(),               // face amount (currency units)
  fixedRate:         z.number(),                          // pct, e.g. 4.25
  payReceive:        z.enum(PAY_RECEIVE),
  effectiveDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturityDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  floatingIndex:     z.enum(FLOATING_INDICES),
  counterparty:      z.string().min(1),
  paymentFreqMonths: z.number().int().positive(),         // typically 3 or 6
});

export type IrsParams = z.infer<typeof IrsParams>;

export const IRS_KEY_FIELDS = [
  'currency','fixedRate','payReceive','effectiveDate','maturityDate',
  'floatingIndex','counterparty','paymentFreqMonths',
] as const satisfies readonly (keyof IrsParams)[];
