"use client";

import { create } from "zustand";

interface SelectedColor {
  id: string | number;
  title: string;
  hex: string;
}

interface MockupJob {
  id: string;
  status: string;
  errorMessage: string | null;
  totalImages?: number;
  completedImages?: number;
  failedImages?: number;
  images?: MockupImage[];
}

interface MockupImage {
  id: string;
  colorName: string;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: string;
  included: boolean;
  sortOrder: number;
  mockupType?: string | null;
  isDefault?: boolean;
  cameraLabel?: string | null;
}

interface StoreColor {
  id: string;
  name: string;
  hex: string;
  enabled?: boolean;
}

interface DraftData {
  id: string;
  designId: string | null;
  storeId: string | null;
  productType: string | null;
  blueprintId: number | null;
  printProviderId: number | null;
  selectedColors: SelectedColor[] | null;
  enabledColorIds: string[] | null;
  enabledSizes: string[] | null;
  store?: {
    colors?: StoreColor[];
    template?: {
      blueprintTitle?: string;
      defaultPlacement?: unknown;
      enabledVariantIds?: number[];
    } | null;
  } | null;
  placementOverride: unknown | null;
  placement: unknown | null;
  aiContent: unknown | null;
  currentStep: number;
  status: string;
  mockupJobs: MockupJob[];
  mockupsStale?: boolean;
  mockupsStaleReason?: string | null;
}

// Phase 6.10 Bug #7: Checklist type shared with layout for Tiếp theo gate
export interface ChecklistData {
  mockupsMatchColors: boolean;
  contentComplete: boolean;
  placementValid: boolean;
  mockupsNotStale: boolean;
  readyToPublish: boolean;
}

interface WizardStore {
  draft: DraftData | null;
  checklist: ChecklistData | null;
  loading: boolean;
  saving: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;

  pendingPatch: Record<string, unknown>;

  loadDraft: (id: string) => Promise<void>;
  updateDraft: (patch: Record<string, unknown>) => Promise<void>;
  saveDraftImmediately: () => Promise<void>;
  setDraft: (draft: DraftData) => void;
  updateMockupJob: (jobId: string, update: Partial<MockupJob>) => void;
  setChecklist: (cl: ChecklistData) => void;
}

export function filterChangedDraftPatch(
  draft: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};

  for (const [key, nextValue] of Object.entries(patch)) {
    const currentValue = draft[key];
    if (!areDraftValuesEqual(currentValue, nextValue)) {
      changed[key] = nextValue;
    }
  }

  return changed;
}

function areDraftValuesEqual(currentValue: unknown, nextValue: unknown): boolean {
  if (currentValue === nextValue) return true;
  if (currentValue == null && nextValue == null) return true;

  if (Array.isArray(currentValue) || Array.isArray(nextValue)) {
    return JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null);
  }

  if (
    typeof currentValue === "object" ||
    typeof nextValue === "object"
  ) {
    return JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null);
  }

  return false;
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  draft: null,
  checklist: null,
  loading: false,
  saving: false,
  saveTimer: null,
  pendingPatch: {},

  loadDraft: async (id: string) => {
    set({ loading: true });
    try {
      const res = await fetch(`/api/wizard/drafts/${id}`);
      if (res.ok) {
        const data = await res.json();
        // GET /api/wizard/drafts/:id now includes checklist (Phase 6.9)
        const { checklist, ...draft } = data;
        set({ draft, checklist: checklist ?? null, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  updateDraft: async (patch: Record<string, unknown>) => {
    const { draft, saveTimer, pendingPatch } = get();
    if (!draft) return;

    const changedPatch = filterChangedDraftPatch(
      draft as unknown as Record<string, unknown>,
      patch,
    );
    if (Object.keys(changedPatch).length === 0) return;

    const newPendingPatch = { ...pendingPatch, ...changedPatch };

    // Optimistic update
    set({
      draft: { ...draft, ...changedPatch } as DraftData,
      pendingPatch: newPendingPatch
    });

    // Debounce save (1s)
    if (saveTimer) clearTimeout(saveTimer);

    const timer = setTimeout(async () => {
      await get().saveDraftImmediately();
    }, 1000);

    set({ saveTimer: timer });
  },

  saveDraftImmediately: async () => {
    const { draft, saveTimer, pendingPatch } = get();
    if (!draft) return;
    if (Object.keys(pendingPatch).length === 0) return; // Nothing to save

    if (saveTimer) {
      clearTimeout(saveTimer);
      set({ saveTimer: null });
    }

    set({ saving: true });
    try {
      const currentPatch = { ...get().pendingPatch };
      // Clear pending patch before request so new updates can accumulate
      set({ pendingPatch: {} });

      const res = await fetch(`/api/wizard/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentPatch),
      });
      if (res.ok) {
        const updated = await res.json();
        set({ draft: { ...get().draft!, ...updated }, saving: false });
      } else {
        // Restore pending patch on failure?
        set({ saving: false, pendingPatch: { ...currentPatch, ...get().pendingPatch } });
      }
    } catch {
      set({ saving: false });
    }
  },

  setDraft: (draft: DraftData) => set({ draft }),

  setChecklist: (cl: ChecklistData) => set({ checklist: cl }),

  updateMockupJob: (jobId: string, update: Partial<MockupJob>) => {
    const { draft } = get();
    if (!draft) return;

    const jobs = draft.mockupJobs.map((j) =>
      j.id === jobId ? { ...j, ...update } : j,
    );
    set({ draft: { ...draft, mockupJobs: jobs } });
  },
}));
