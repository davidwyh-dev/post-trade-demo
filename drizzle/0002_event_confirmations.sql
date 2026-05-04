-- =====================================================
-- EVENT CONFIRMATIONS (operational state, NOT part of the ledger)
--
-- The events table is append-only. Confirmation state is a sibling:
-- one row per event, mutable. The ledger stays immutable; ops state evolves.
--
-- Two confirmations per event:
--   1. amount_confirmed   — operator has reconciled the cash amount /
--                           fixing rate against the source. Cleared when the
--                           operator overrides the figure (handled upstream by
--                           appending an AMEND event scoped to the prior event).
--   2. reconciled         — payment has been paid (outgoing) or received
--                           (incoming) at the cash side.
--
-- Derived status:
--   PENDING            — neither flag set
--   AMOUNT_CONFIRMED   — amount_confirmed = true, reconciled = false
--   SETTLED            — both flags set
--
-- Foreign key cascades on event delete are RESTRICT — events can't be deleted
-- (trigger forbids it), and we want a clear error if anything ever tries.
-- =====================================================
CREATE TABLE event_confirmations (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              BIGINT NOT NULL UNIQUE REFERENCES events(id) ON DELETE RESTRICT,
  amount_confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
  amount_confirmed_at   TIMESTAMPTZ,
  reconciled            BOOLEAN NOT NULL DEFAULT FALSE,
  reconciled_at         TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_confirmations_status
  ON event_confirmations (amount_confirmed, reconciled);

-- Keep updated_at in sync on UPDATE.
CREATE OR REPLACE FUNCTION touch_event_confirmation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_confirmations_touch_updated_at
  BEFORE UPDATE ON event_confirmations
  FOR EACH ROW EXECUTE FUNCTION touch_event_confirmation_updated_at();
