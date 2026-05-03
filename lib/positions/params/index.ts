import { z } from 'zod';
import { IrsParams, IRS_KEY_FIELDS } from './irs';
import { FutureParams, FUTURE_KEY_FIELDS } from './future';
import { TreasuryParams, TREASURY_KEY_FIELDS } from './treasury';
import { FxParams, FX_KEY_FIELDS } from './fx';
import type { ProductType } from '@/lib/db/schema';

export { IrsParams, FutureParams, TreasuryParams, FxParams };

// Discriminated union over `product`. Validated at every API boundary that
// accepts position params (POST /api/positions, /api/positions/resolve,
// /api/parse-trade response handlers).
export const PositionParams = z.discriminatedUnion('product', [
  IrsParams,
  FutureParams,
  TreasuryParams,
  FxParams,
]);

export type PositionParams = z.infer<typeof PositionParams>;

// Per-product schemas keyed by product enum, for places that already know
// the product (e.g. the trade-CLI tool dispatch).
export const PARAMS_BY_PRODUCT = {
  IRS:      IrsParams,
  FUTURE:   FutureParams,
  TREASURY: TreasuryParams,
  FX:       FxParams,
} as const satisfies Record<ProductType, z.ZodTypeAny>;

// KEY_FIELDS define position identity per product. Anything NOT in this list
// can be mutated by appending an event (e.g. notional via AMEND, status via
// TERMINATION) without changing the position's identity.
export const KEY_FIELDS: Record<ProductType, readonly string[]> = {
  IRS:      IRS_KEY_FIELDS,
  FUTURE:   FUTURE_KEY_FIELDS,
  TREASURY: TREASURY_KEY_FIELDS,
  FX:       FX_KEY_FIELDS,
};
