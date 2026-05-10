import { create } from 'zustand';
import type { Event, EventType } from '@/lib/db/schema';
import type { EnrichedEvent } from '@/lib/positions/query';

export type ConfirmationFilter = {
  fromDate: string;            // YYYY-MM-DD inclusive
  toDate:   string;            // YYYY-MM-DD inclusive
  eventTypes?:        EventType[];
  counterparty?:      string;
  rateIndex?:         string;
  confirmationStatus?: 'PENDING' | 'AMOUNT_CONFIRMED' | 'SETTLED';
};

/**
 * Per-event reconciliation result returned by the confirmations parser when
 * the operator submits PDF attachments. In-memory only — cleared on reload
 * and not persisted on the Confirmation row.
 */
export type ReconcileResult = {
  status: 'MATCH' | 'MISMATCH';
  confidence: number;       // 0..1, model-reported
  reasons: string[];        // short bullets, model-reported
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type State = {
  events: EnrichedEvent[];
  /** Full event chains per position; needed to resolve AMEND overrides. */
  allEventsByPosition: Record<number, Event[]>;
  selectedEventIds: number[];
  /** Index into selectedEventIds for the Event Details paginator. */
  paginatedIndex: number;
  filter: ConfirmationFilter;
  loading: boolean;
  cliText: string;
  cliBusy: boolean;
  /** Reconciliation results keyed by event id. Cleared on reload. */
  reconciliation: Record<number, ReconcileResult>;

  setEvents: (events: EnrichedEvent[], allByPosition: Record<number, Event[]>) => void;
  setLoading: (v: boolean) => void;
  setFilter: (patch: Partial<ConfirmationFilter>) => void;
  resetFilter: () => void;

  toggleSelect: (id: number) => void;
  selectMany: (ids: number[], replace?: boolean) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  nextPage: () => void;
  prevPage: () => void;

  setCliText: (text: string) => void;
  setCliBusy: (busy: boolean) => void;

  setReconciliation: (results: Record<number, ReconcileResult>) => void;
  clearReconciliation: () => void;
};

export const useConfirmationsStore = create<State>((set) => ({
  events: [],
  allEventsByPosition: {},
  selectedEventIds: [],
  paginatedIndex: 0,
  filter: { fromDate: todayIso(), toDate: todayIso() },
  loading: false,
  cliText: '',
  cliBusy: false,
  reconciliation: {},

  setEvents: (events, allByPosition) =>
    set((s) => {
      // Drop selections that are no longer in the visible set.
      const visibleIds = new Set(events.map((e) => e.id));
      const stillSelected = s.selectedEventIds.filter((id) => visibleIds.has(id));
      // Drop reconciliation results for events no longer visible.
      const reconciliation: Record<number, ReconcileResult> = {};
      for (const id of Object.keys(s.reconciliation)) {
        const numId = Number(id);
        if (visibleIds.has(numId)) reconciliation[numId] = s.reconciliation[numId];
      }
      return {
        events,
        allEventsByPosition: allByPosition,
        selectedEventIds: stillSelected,
        paginatedIndex: stillSelected.length === 0 ? 0 : Math.min(s.paginatedIndex, stillSelected.length - 1),
        reconciliation,
      };
    }),

  setLoading: (loading) => set({ loading }),

  setFilter: (patch) =>
    set((s) => ({ filter: { ...s.filter, ...patch } })),

  resetFilter: () =>
    set({ filter: { fromDate: todayIso(), toDate: todayIso() } }),

  toggleSelect: (id) =>
    set((s) => {
      const has = s.selectedEventIds.includes(id);
      const next = has
        ? s.selectedEventIds.filter((x) => x !== id)
        : [...s.selectedEventIds, id];
      return {
        selectedEventIds: next,
        paginatedIndex: next.length === 0
          ? 0
          : Math.min(s.paginatedIndex, next.length - 1),
      };
    }),

  selectMany: (ids, replace = false) =>
    set((s) => {
      // Order selections by their order in `events` so pagination feels natural.
      const order = new Map(s.events.map((e, i) => [e.id, i]));
      const merged = replace ? [...ids] : Array.from(new Set([...s.selectedEventIds, ...ids]));
      merged.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      return { selectedEventIds: merged, paginatedIndex: 0 };
    }),

  selectAllVisible: () =>
    set((s) => ({ selectedEventIds: s.events.map((e) => e.id), paginatedIndex: 0 })),

  clearSelection: () => set({ selectedEventIds: [], paginatedIndex: 0 }),

  nextPage: () =>
    set((s) => ({
      paginatedIndex: s.selectedEventIds.length === 0
        ? 0
        : (s.paginatedIndex + 1) % s.selectedEventIds.length,
    })),

  prevPage: () =>
    set((s) => ({
      paginatedIndex: s.selectedEventIds.length === 0
        ? 0
        : (s.paginatedIndex - 1 + s.selectedEventIds.length) % s.selectedEventIds.length,
    })),

  setCliText: (cliText) => set({ cliText }),
  setCliBusy: (cliBusy) => set({ cliBusy }),

  setReconciliation: (reconciliation) => set({ reconciliation }),
  clearReconciliation: () => set({ reconciliation: {} }),
}));

/** Predicate against the in-memory events list. Mirrors what `eventTypes`,
 * `counterparty`, `rateIndex`, and `confirmationStatus` would do server-side
 * if we pushed them into the SQL query. Server already filters by date, so
 * this only handles the post-fetch refinements. */
export function applyClientFilter(events: EnrichedEvent[], f: ConfirmationFilter): EnrichedEvent[] {
  return events.filter((e) => {
    if (f.eventTypes && f.eventTypes.length > 0 && !f.eventTypes.includes(e.eventType)) return false;
    if (f.counterparty) {
      const ctp = (e.position.params as Record<string, unknown>).counterparty;
      const fromPayload = (e.payload as Record<string, unknown>).toCounterparty
                       ?? (e.payload as Record<string, unknown>).fromCounterparty;
      if (String(ctp ?? fromPayload ?? '') !== f.counterparty) return false;
    }
    if (f.rateIndex) {
      const idx = (e.position.params as Record<string, unknown>).floatingIndex;
      if (String(idx ?? '') !== f.rateIndex) return false;
    }
    if (f.confirmationStatus) {
      const c = e.confirmation;
      const status: 'PENDING' | 'AMOUNT_CONFIRMED' | 'SETTLED' =
        !c ? 'PENDING'
        : (c.amountConfirmed && c.reconciled) ? 'SETTLED'
        : c.amountConfirmed ? 'AMOUNT_CONFIRMED'
        : 'PENDING';
      if (status !== f.confirmationStatus) return false;
    }
    return true;
  });
}
