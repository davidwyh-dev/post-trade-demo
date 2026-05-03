-- Post-Trade Book of Record schema. The invariants in this file ARE the demo:
-- positions and events are append-only. Lifecycle changes happen by appending
-- a new event, never by mutating prior records.

-- =====================================================
-- COUNTERPARTIES (lookup, mutable)
-- =====================================================
CREATE TABLE counterparties (
  code        TEXT PRIMARY KEY,         -- 'JPM', 'GS', 'MS'
  name        TEXT NOT NULL,            -- 'JPMorgan Chase Bank, N.A.'
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- ENUMS
-- =====================================================
CREATE TYPE product_type    AS ENUM ('IRS','FUTURE','TREASURY','FX');
CREATE TYPE position_status AS ENUM ('OPEN','CLOSED','TERMINATED');
CREATE TYPE event_type      AS ENUM (
  'NEW','AMEND','RATE_RESET','COUPON','NOVATION',
  'TERMINATION','ROLL','EXPIRY','CANCEL','PARTIAL_UNWIND'
);

-- =====================================================
-- POSITIONS
--
-- product + position_key uniquely identifies a position. position_key is a
-- deterministic sha256 of the product-specific KEY_FIELDS, computed in
-- lib/positions/key.ts. params holds the full validated parameter object.
--
-- Mutability:
--   product, position_key, params, opened_at  -> immutable (trigger-enforced)
--   status, closed_at, metadata               -> mutable (lifecycle terminal state)
-- =====================================================
CREATE TABLE positions (
  id            BIGSERIAL PRIMARY KEY,
  product       product_type NOT NULL,
  position_key  CHAR(64) NOT NULL,
  params        JSONB NOT NULL,
  status        position_status NOT NULL DEFAULT 'OPEN',
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX positions_key_unique ON positions (product, position_key);
CREATE INDEX positions_status            ON positions (status);

-- =====================================================
-- EVENTS (append-only ledger of lifecycle activity per position)
--
-- sequence_no is the dense 1..N order within a position.
-- parent_event_id forms the DAG: linear chains follow the prior event;
-- branching events (PARTIAL_UNWIND, NOVATION) create a fork.
-- effective_at = business time; created_at = system time.
-- external_id supports idempotent retries.
-- =====================================================
CREATE TABLE events (
  id              BIGSERIAL PRIMARY KEY,
  position_id     BIGINT NOT NULL REFERENCES positions(id),
  sequence_no     INTEGER NOT NULL CHECK (sequence_no > 0),
  event_type      event_type NOT NULL,
  parent_event_id BIGINT REFERENCES events(id),
  payload         JSONB NOT NULL,
  external_id     TEXT UNIQUE,
  effective_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX events_position_seq      ON events (position_id, sequence_no);
CREATE INDEX        events_position_created  ON events (position_id, created_at);

-- =====================================================
-- INVARIANT 1: events table is append-only
--
-- Lifecycle corrections happen by appending a CANCEL or compensating
-- event, never by mutating the prior row.
-- =====================================================
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Append-only invariant violated: % is append-only. Append a compensating event instead.',
    TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER events_no_delete BEFORE DELETE ON events FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- =====================================================
-- INVARIANT 2: positions table is partly immutable
--
-- product, position_key, params, opened_at must never change. Lifecycle
-- terminal state (status, closed_at, metadata) is the only legal mutation.
-- =====================================================
CREATE OR REPLACE FUNCTION assert_position_columns_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product      <> OLD.product
  OR NEW.position_key <> OLD.position_key
  OR NEW.params::text <> OLD.params::text
  OR NEW.opened_at    <> OLD.opened_at THEN
    RAISE EXCEPTION
      'Position invariant violated: only status, closed_at, metadata are mutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER positions_immutable_cols BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION assert_position_columns_immutable();
CREATE TRIGGER positions_no_delete      BEFORE DELETE ON positions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- =====================================================
-- INVARIANT 3: per-position sequence_no is dense (1..N, no gaps)
--
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED so it fires at COMMIT,
-- after a multi-event txn has finished inserting.
-- =====================================================
CREATE OR REPLACE FUNCTION assert_event_sequence_dense()
RETURNS TRIGGER AS $$
DECLARE
  expected INTEGER;
  actual   INTEGER;
BEGIN
  SELECT COUNT(*), MAX(sequence_no)
  INTO actual, expected
  FROM events
  WHERE position_id = NEW.position_id;

  IF expected IS NULL THEN
    -- All events for this position were deleted in the same txn;
    -- nothing to validate.
    RETURN NEW;
  END IF;

  IF actual <> expected THEN
    RAISE EXCEPTION
      'Sequence invariant violated: position % has % events but max sequence_no = %',
      NEW.position_id, actual, expected;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER events_seq_dense
  AFTER INSERT ON events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_event_sequence_dense();

-- =====================================================
-- INVARIANT 4: the first event of a position must be NEW
-- =====================================================
CREATE OR REPLACE FUNCTION assert_first_event_is_new()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sequence_no = 1 AND NEW.event_type <> 'NEW' THEN
    RAISE EXCEPTION
      'Lifecycle invariant violated: first event of a position must be NEW (got %)',
      NEW.event_type;
  END IF;
  IF NEW.sequence_no > 1 AND NEW.event_type = 'NEW' THEN
    RAISE EXCEPTION
      'Lifecycle invariant violated: NEW event must have sequence_no = 1 (got %)',
      NEW.sequence_no;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_first_is_new BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION assert_first_event_is_new();
