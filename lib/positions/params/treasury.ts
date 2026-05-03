import { z } from 'zod';
import { G10_CURRENCIES, SIDES } from '@/lib/constants';

// Government bond / treasury. Identified by ISIN (or CUSIP) plus side.
// Counterparty lives on the trade event, not the position — a hedge fund
// holds one logical position per (ISIN, side, account) regardless of which
// dealer the trades came from.
export const TreasuryParams = z.object({
  product:     z.literal('TREASURY'),
  isin:        z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/),
  cusip:       z.string().optional(),
  issuer:      z.string().min(1),                   // 'US Treasury', 'UK DMO', 'Bund'
  currency:    z.enum(G10_CURRENCIES),
  coupon:      z.number().nonnegative(),            // annualized pct
  maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  side:        z.enum(SIDES),
  account:     z.string().min(1),
  initialFaceAmount: z.number().positive(),         // in currency units
});

export type TreasuryParams = z.infer<typeof TreasuryParams>;

export const TREASURY_KEY_FIELDS = [
  'isin','side','account',
] as const satisfies readonly (keyof TreasuryParams)[];
