import { create } from 'zustand';
import type { Position, Event } from '@/lib/db/schema';
import type { PositionParams } from '@/lib/positions/params';

export type DetailsMode =
  | { kind: 'idle' }
  | { kind: 'view'; positionId: number }
  | { kind: 'create'; prefill?: Partial<PositionParams> }
  | { kind: 'event'; positionId: number; eventType: string; prefill?: Record<string, unknown> };

type State = {
  positions: Position[];
  events: Event[];
  selectedPositionId: number | null;
  detailsMode: DetailsMode;
  cliText: string;
  cliBusy: boolean;
  showProjected: boolean;

  setPositions: (positions: Position[]) => void;
  setEvents: (events: Event[]) => void;
  selectPosition: (id: number | null) => void;
  setDetailsMode: (mode: DetailsMode) => void;
  setCliText: (text: string) => void;
  setCliBusy: (busy: boolean) => void;
  setShowProjected: (v: boolean) => void;
};

export const useTradeStore = create<State>((set) => ({
  positions: [],
  events: [],
  selectedPositionId: null,
  detailsMode: { kind: 'idle' },
  cliText: '',
  cliBusy: false,
  showProjected: false,

  setPositions: (positions) => set({ positions }),
  setEvents: (events) => set({ events }),
  selectPosition: (id) =>
    set({
      selectedPositionId: id,
      detailsMode: id !== null ? { kind: 'view', positionId: id } : { kind: 'idle' },
    }),
  setDetailsMode: (detailsMode) => set({ detailsMode }),
  setCliText: (cliText) => set({ cliText }),
  setCliBusy: (cliBusy) => set({ cliBusy }),
  setShowProjected: (showProjected) => set({ showProjected }),
}));
