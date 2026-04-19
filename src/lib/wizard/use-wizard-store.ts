"use client";

import { create } from "zustand";

interface SelectedColor {
  id: string | number;
  title: string;
  hex: string;
}

interface Placement {
  x: number;
  y: number;
  scale: number;
  position: "FRONT" | "BACK" | "SLEEVE";
}

interface MockupJob {
  id: string;
  colorName: string;
  colorHex: string;
  status: string;
  mockupStoragePath: string | null;
  errorMessage: string | null;
}

interface DraftData {
  id: string;
  designId: string | null;
  storeId: string | null;
  productType: string | null;
  blueprintId: number | null;
  printProviderId: number | null;
  selectedColors: SelectedColor[] | null;
  placement: Placement | null;
  aiContent: unknown | null;
  currentStep: number;
  status: string;
  mockupJobs: MockupJob[];
}

interface WizardStore {
  draft: DraftData | null;
  loading: boolean;
  saving: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;

  loadDraft: (id: string) => Promise<void>;
  updateDraft: (patch: Record<string, unknown>) => Promise<void>;
  setDraft: (draft: DraftData) => void;
  updateMockupJob: (jobId: string, update: Partial<MockupJob>) => void;
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  draft: null,
  loading: false,
  saving: false,
  saveTimer: null,

  loadDraft: async (id: string) => {
    set({ loading: true });
    try {
      const res = await fetch(`/api/wizard/drafts/${id}`);
      if (res.ok) {
        const draft = await res.json();
        set({ draft, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  updateDraft: async (patch: Record<string, unknown>) => {
    const { draft, saveTimer } = get();
    if (!draft) return;

    // Optimistic update
    set({
      draft: { ...draft, ...patch } as DraftData,
    });

    // Debounce save (1s)
    if (saveTimer) clearTimeout(saveTimer);

    const timer = setTimeout(async () => {
      set({ saving: true });
      try {
        const res = await fetch(`/api/wizard/drafts/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const updated = await res.json();
          set({ draft: { ...get().draft!, ...updated }, saving: false });
        } else {
          set({ saving: false });
        }
      } catch {
        set({ saving: false });
      }
    }, 1000);

    set({ saveTimer: timer });
  },

  setDraft: (draft: DraftData) => set({ draft }),

  updateMockupJob: (jobId: string, update: Partial<MockupJob>) => {
    const { draft } = get();
    if (!draft) return;

    const jobs = draft.mockupJobs.map((j) =>
      j.id === jobId ? { ...j, ...update } : j,
    );
    set({ draft: { ...draft, mockupJobs: jobs } });
  },
}));
