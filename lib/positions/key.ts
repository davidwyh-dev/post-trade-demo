import { createHash } from 'node:crypto';
import { KEY_FIELDS, type PositionParams } from './params';

// Normalize a key-field value to a canonical form so semantically equivalent
// inputs produce the same hash. Strings are upper-cased; numbers are fixed
// to 10 decimal places (collapsing 4.25 vs 4.2500000000); arrays sorted.
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.toUpperCase().trim();
  if (typeof value === 'number') return Number(value.toFixed(10));
  if (Array.isArray(value)) return [...value].map(normalize).sort();
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = normalize((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

// Canonical JSON: sorted keys, normalized leaves. Same input → same string,
// regardless of original key order.
function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = normalize(obj[k]);
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

/**
 * Compute the deterministic position key for a given set of parameters.
 *
 * Two parameter objects produce the same key iff their KEY_FIELDS match
 * after normalization. This is what the database's
 * positions_key_unique index enforces.
 */
export function computeKey(params: PositionParams): string {
  const fields = KEY_FIELDS[params.product];
  const subset: Record<string, unknown> = {};
  for (const f of fields) {
    subset[f] = (params as Record<string, unknown>)[f];
  }
  const canon = canonicalJson(subset);
  return createHash('sha256').update(`${params.product}|${canon}`).digest('hex');
}
