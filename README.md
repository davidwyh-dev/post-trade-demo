# Post-Trade Book of Record

An append-only post-trade execution & lifecycle management demo for a macro hedge fund. Captures **Interest Rate Swaps, Futures, Treasuries, and FX (Spot/Forward/Swap)** in G10 currencies. Lifecycle events (rate resets, coupons, novations, terminations, rolls, partial unwinds) accrete onto positions as a DAG.

The whole demo is one page — `/trade` — with four quadrants:

```
┌──────────────────────────────────────────────────────────┐
│  Position Table                                          │
├─────────────────────────────┬────────────────────────────┤
│  Position Details           │  Event DAG                 │
│  (form when no selection)   │  (react-flow + dagre)      │
├─────────────────────────────┴────────────────────────────┤
│  Trade CLI — natural language → structured trade         │
└──────────────────────────────────────────────────────────┘
```

The **Trade CLI** parses trader shorthand ("buy 100mm 5y USD pay fixed at 4.25 vs SOFR JPM") with **Claude Haiku 4.5** + tool use, then either matches an existing position by deterministic key or pre-fills the new-position form.

## What makes the demo

Append-only is enforced **in the database**, not the application:

- `events` table: `BEFORE UPDATE`/`BEFORE DELETE` triggers reject any mutation. Lifecycle changes happen by appending a new event, never by editing a prior row.
- `positions` table: `params` and identity fields are immutable; only `status`/`closed_at`/`metadata` can change (column-aware trigger).
- A deferred constraint trigger asserts `(position_id, sequence_no)` is dense (1..N, no gaps) per position.
- Genesis-event trigger asserts the first event of any position is `NEW`, and `NEW` only ever appears at `sequence_no = 1`.

Position identity is a deterministic `sha256` of normalized key fields per product (currency + rate + counterparty for IRS, ISIN + side + account for treasuries, etc.). The `positions_key_unique` index prevents duplicate positions; same input in any order produces the same key.

The Trade CLI is the only Claude-powered surface. System prompt + tool definitions are cached (`cache_control: ephemeral`); only the user's text and today's date vary per call.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind v4 (dark-mode-first, CSS variables)
- Drizzle ORM + `embedded-postgres` (no install — auto-starts on `npm run dev:db`)
- React Flow + dagre (Event DAG)
- Anthropic SDK + Claude Haiku 4.5 (tool use, prompt caching)
- Zustand · react-hook-form + zod · sonner · lucide-react
- Vitest with embedded-pg fixture (33 tests covering invariants, position keys, event flows)

## Running it

### Prerequisites

- Node 20+
- An Anthropic API key (only needed for the Trade CLI; the rest of the app works without one)

### First-time setup

```bash
# 1. Install
npm install

# 2. Copy the env template and add your API key
cp .env.local.example .env.local
# then edit .env.local and replace the ANTHROPIC_API_KEY placeholder

# 3. Start the embedded Postgres + apply migrations (terminal 1, leave running)
npm run dev:db -- --fresh

# 4. Seed positions across all 4 products with lifecycle events
npm run seed

# 5. Start the dev server (terminal 2)
npm run dev
```

Open [http://localhost:3000/trade](http://localhost:3000/trade).

> The shell sometimes pre-sets `ANTHROPIC_API_KEY=` to an empty string (e.g. inside Claude Code's bash sandbox), which prevents `.env.local` from being applied. If you see "ANTHROPIC_API_KEY is not set" despite a real key in `.env.local`, run `unset ANTHROPIC_API_KEY` in the shell that runs `npm run dev`, then restart.

### Subsequent runs

```bash
npm run dev:db   # terminal 1 (without --fresh — preserves data)
npm run dev      # terminal 2
```

### Tests

```bash
npm test
```

33 tests covering: append-only triggers, sequence-density invariants, lifecycle invariants (first-event-must-be-NEW), position-key determinism per product, end-to-end position creation, idempotent retries, branching DAGs (PARTIAL_UNWIND), and all four product types.

## Demo script

1. Open `/trade`. Twelve seeded positions across IRS, Future, Treasury, FX.
2. Click an IRS row. The Position Details panel shows the params; the Event DAG shows the `NEW` → `RATE_RESET` → ... chain; the CLI bottom shows a plain-English summary.
3. In the CLI, type:
   ```
   buy 50mm 2y EUR pay fixed at 2.85 vs ESTR with DB
   ```
   The parser returns no match; the new-position form opens pre-filled with the parsed params. Submit.
4. Re-type the same phrase. The parser now matches the position you just created and auto-selects it.
5. With a position selected, type `terminate`. The Termination event form opens pre-filled. Submit. The DAG appends a `TERMINATION` node and the row's status flips to `TERMINATED`.
6. Try to break the invariants — open `psql` (or any Postgres client) against `postgres://postgres:dev@127.0.0.1:54330/postgres` and run:
   ```sql
   UPDATE events SET payload = '{"hacked":true}'::jsonb WHERE id = 1;
   ```
   The trigger rejects it with: `Append-only invariant violated: events is append-only. Append a compensating event instead.`

## Project layout

```
app/
  trade/                          # the four-quadrant page
    page.tsx
    _components/
      TradeWorkspace.tsx
      PositionTable.tsx
      PositionDetails.tsx         # router: view / new / event-form
      ViewPosition.tsx
      NewPositionForm.tsx         # per-product tabs (IRS, Future, Treasury, FX)
      EventForm.tsx
      EventDag.tsx                # react-flow + dagre wrapper
      EventNode.tsx               # custom DAG node renderer per event type
      TradeCli.tsx
  api/
    positions/
      route.ts                    # GET list, POST create
      resolve/route.ts            # POST { params } -> { positionId | null }
      [id]/route.ts               # GET position + events
      [id]/events/[type]/route.ts # POST one event of `type` (dispatched via FLOW_REGISTRY)
    parse-trade/route.ts          # Claude Haiku 4.5 + tool use

lib/
  db/{schema,client,migrate}.ts
  positions/
    params/{irs,future,treasury,fx,index}.ts   # per-product Zod + KEY_FIELDS
    key.ts                                     # deterministic position-key hash
    create.ts                                  # creates a position + first NEW event
    append.ts                                  # appends events, sequencing + retry
    flows/index.ts                             # 9 lifecycle event flows
    query.ts · summary.ts · errors.ts
  parser/
    anthropic.ts                               # SDK call wrapper
    tools.ts                                   # tool defs (propose_create_position, propose_event)
    prompt.ts                                  # cached system prompt with desk lingo
  viz/dag/{buildGraph,layout}.ts
  store/tradeStore.ts
  constants.ts utils.ts

drizzle/
  0000_init.sql                                # tables, enums, append-only triggers
  0001_seed_counterparties.sql                 # G-SIBs with aliases

scripts/
  dev-db.ts                                    # long-running embedded-pg
  seed.ts                                      # 12 positions across 4 products

tests/
  setup.ts                                     # embedded-pg fixture
  invariants.test.ts                           # append-only + lifecycle triggers
  positions.test.ts                            # key determinism per product
  events.test.ts                               # end-to-end flow registry
```

## Decisions baked in

- **DAG branches stay within a position** via `parent_event_id`. PARTIAL_UNWIND, NOVATION, ROLL append branching events to the same position rather than spawning a new one.
- **FX positions are separate per ticket**; rate is event-level, not part of the position key.
- **Treasury identity = ISIN + side + account**; counterparty lives on the trade event.
- **Counterparties are seeded** as G-SIBs (JPM, GS, MS, BAML, CITI, BARC, DB, UBS, HSBC, BNP, SG) with aliases so the parser resolves "JPMorgan" / "jpm" / "jpmc" → `JPM`.
- **Sequence-conflict retry** lives on the server (3x serializable txn) — concurrent appenders never surface a 409 to the UI.
- **Reader/writer split kept** even on single-node dev for parity with the production-style pattern in the sibling `ledger-demo`.
- **Confidence threshold 0.85** for auto-selecting a parser-matched position; below that, the new-position form opens for trader confirmation.

## Non-goals

- Authentication / multi-user (demo only).
- Real broker / exchange connectivity, real market-data fixings.
- Risk / P&L / VaR (this is a Book of Record, not a risk system).
- Trade matching / confirmations / settlement.
