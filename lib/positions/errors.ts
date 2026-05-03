export type PositionErrorPayload = {
  kind: 'invariant' | 'validation' | 'not-found' | 'duplicate' | 'other';
  message: string;
  pgCode?: string;
};

/**
 * Convert any error thrown by a flow into a structured payload for the UI.
 * Postgres `RAISE EXCEPTION` messages from our triggers are surfaced verbatim
 * — that IS the demo on the "break it" path.
 */
export function toPositionError(err: unknown): PositionErrorPayload {
  const e = err as { message?: string; code?: string; constraint_name?: string };
  const message = e?.message ?? String(err);

  if (typeof message === 'string' && /append-only|invariant violated/i.test(message)) {
    return { kind: 'invariant', message, pgCode: e?.code };
  }
  if (e?.code === '23505') {
    return {
      kind: 'duplicate',
      message: e?.constraint_name === 'positions_key_unique'
        ? 'A position with these key parameters already exists.'
        : message,
      pgCode: e?.code,
    };
  }
  return { kind: e?.code ? 'validation' : 'other', message, pgCode: e?.code };
}
