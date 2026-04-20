/**
 * Zustand store for placement undo/redo history (Phase 6.7)
 * Capped at 20 steps. Debounce push 300ms to avoid flooding on drag.
 */
import { create } from "zustand";
import type { PlacementData } from "@/lib/placement/types";

interface HistoryState {
  past: PlacementData[];
  present: PlacementData | null;
  future: PlacementData[];
}

interface PlacementHistoryStore {
  history: HistoryState;
  pushDebounced: (next: PlacementData) => void;
  undo: () => PlacementData | null;
  redo: () => PlacementData | null;
  clear: () => void;
  _timerId: ReturnType<typeof setTimeout> | null;
}

const MAX_STEPS = 20;

export const usePlacementHistory = create<PlacementHistoryStore>((set, get) => ({
  history: { past: [], present: null, future: [] },
  _timerId: null,

  pushDebounced: (next: PlacementData) => {
    // Clear any pending debounce
    const existing = get()._timerId;
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      set((state) => {
        const h = state.history;
        const pastNext = h.present
          ? [...h.past, h.present].slice(-MAX_STEPS)
          : h.past;
        return {
          history: { past: pastNext, present: next, future: [] },
          _timerId: null,
        };
      });
    }, 300);

    set({ _timerId: timerId });
  },

  undo: () => {
    const h = get().history;
    if (h.past.length === 0 || !h.present) return null;

    const prev = h.past[h.past.length - 1];
    set({
      history: {
        past: h.past.slice(0, -1),
        present: prev,
        future: [h.present, ...h.future],
      },
    });
    return prev;
  },

  redo: () => {
    const h = get().history;
    if (h.future.length === 0) return null;

    const [next, ...rest] = h.future;
    set({
      history: {
        past: h.present ? [...h.past, h.present] : h.past,
        present: next,
        future: rest,
      },
    });
    return next;
  },

  clear: () =>
    set({ history: { past: [], present: null, future: [] }, _timerId: null }),
}));
