"use client";

import { create } from "zustand";
import { getDraftDesignIds } from "./design-selection";

interface SelectedColor {
  id: string | number;
  title: string;
  hex: string;
}

interface MockupJob {
  id: string;
  draftDesignId?: string | null;
  designId?: string | null;
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

interface DraftDesign {
  id: string;
  designId: string;
  sortOrder: number;
  design?: {
    id: string;
    name: string;
    previewPath?: string | null;
    [key: string]: unknown;
  } | null;
  jobs?: MockupJob[];
}

interface StoreColor {
  id: string;
  name: string;
  hex: string;
  colorGroup?: string | null;
  enabled?: boolean;
}

interface WizardDraftDesignPair {
  id: string;
  draftId: string;
  baseName: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
  sortOrder: number;
  aiContent?: unknown | null;
  lightDesign?: DraftDesign | null;
  darkDesign?: DraftDesign | null;
  listing?: unknown | null;
}

interface DraftData {
  id: string;
  designId: string | null;
  storeId: string | null;
  templateId: string | null;
  productType: string | null;
  blueprintId: number | null;
  printProviderId: number | null;
  selectedColors: SelectedColor[] | null;
  enabledColorIds: string[] | null;
  enabledSizes: string[] | null;
  // Per-color sizes: { colorName → string[] }. Null = use enabledSizes as fallback.
  enabledSizesByColor: Record<string, string[]> | null;
  design?: {
    id: string;
    name: string;
    storagePath: string;
    previewPath?: string | null;
  } | null;
  template?: {
    id: string;
    blueprintTitle?: string;
    defaultPlacement?: unknown;
    enabledVariantIds?: number[];
    basePriceUsd?: number | string | null;
    priceBySizeDefault?: Record<string, number> | null;
  } | null;
  store?: {
    defaultPriceUsd?: number | string | null;
    colors?: StoreColor[];
    template?: {
      blueprintTitle?: string;
      defaultPlacement?: unknown;
      enabledVariantIds?: number[];
      basePriceUsd?: number | string | null;
      priceBySizeDefault?: Record<string, number> | null;
    } | null;
    templates?: Array<{
      id: string;
      name: string;
      isDefault: boolean;
      blueprintTitle?: string;
      printProviderTitle?: string;
      defaultPlacement?: unknown;
      enabledVariantIds?: number[];
      enabledSizes?: string[];
      enabledSizesByColor?: Record<string, string[]> | null;
      basePriceUsd?: number | string | null;
      priceBySizeDefault?: Record<string, number> | null;
    }>;
  } | null;
  placementOverride: unknown | null;
  placement: unknown | null;
  aiContent: unknown | null;
  currentStep: number;
  status: string;
  draftDesigns?: DraftDesign[];
  designPairs?: WizardDraftDesignPair[];
  mockupJobs: MockupJob[];
  mockupsStale?: boolean;
  mockupsStaleReason?: string | null;
  priceBySizeOverride?: Record<string, number> | null;
}

export function getDraftDesignIdsFromDraft(
  draft: Pick<DraftData, "designId" | "draftDesigns"> | null | undefined,
): string[] {
  if (!draft) return [];

  return getDraftDesignIds(draft);
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
  // Step-5 bundled size data from ?expand=sizes
  expandedSizes: Array<{ size: string; costCents: number; costDeltaCents: number }> | null;
  loading: boolean;
  saving: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;

  pendingPatch: Record<string, unknown>;

  loadDraft: (id: string, expand?: string) => Promise<void>;
  updateDraft: (
    patch: Record<string, unknown>,
    options?: { debounce?: boolean },
  ) => Promise<void>;
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

export const useWizardStore = create<WizardStore>((set, get) => {
  // In-flight dedup: prevents concurrent loadDraft calls for the same ID
  // (e.g. React StrictMode double-invoke) from making duplicate API requests.
  let inFlightLoad: { id: string; promise: Promise<void> } | null = null;

  return {
  draft: null,
  checklist: null,
  expandedSizes: null,
  loading: false,
  saving: false,
  saveTimer: null,
  pendingPatch: {},

  loadDraft: async (id: string, expand?: string) => {
    // Dedup key includes expand to distinguish slim vs expanded loads
    const dedupKey = expand ? `${id}:${expand}` : id;
    // If already loading this exact draft+expand combo, wait for the existing request
    if (inFlightLoad?.id === dedupKey) {
      return inFlightLoad.promise;
    }

    const promise = (async () => {
      set({ loading: true });
      try {
        const url = expand
          ? `/api/wizard/drafts/${id}?expand=${encodeURIComponent(expand)}`
          : `/api/wizard/drafts/${id}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          // GET /api/wizard/drafts/:id now includes checklist (Phase 6.9)
          const { checklist, sizes, ...draft } = data;
          set({
            draft,
            checklist: checklist ?? null,
            expandedSizes: sizes?.sizes ?? null,
            loading: false,
          });
        } else {
          set({ loading: false });
        }
      } catch {
        set({ loading: false });
      } finally {
        if (inFlightLoad?.id === dedupKey) inFlightLoad = null;
      }
    })();

    inFlightLoad = { id: dedupKey, promise };
    return promise;
  },

  updateDraft: async (patch: Record<string, unknown>, options?: { debounce?: boolean }) => {
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

    if (options?.debounce === false) {
      return;
    }

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
};});
