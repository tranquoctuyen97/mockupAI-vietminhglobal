import type { MockupLibraryView } from "@prisma/client";

import type { CompositeRegionPx } from "@/lib/mockup/custom-library";

export type WizardCustomMockupInput = {
  source: { url: string } | { mockupLibraryItemId: string };
  name?: string;
  view: MockupLibraryView;
  appliesToColorRefs: string[] | ["all"];
  compositeRegionPx?: CompositeRegionPx;
  isPrimary?: boolean;
  sortOrder?: number;
};

export type SerializedDraftMockupSource = {
  id: string;
  name: string;
  view: MockupLibraryView;
  storagePath: string | null;
  mockupLibraryItemId: string | null;
  appliesToColorIds: string[];
  appliesToAll: boolean;
  compositeRegionPx: CompositeRegionPx | null;
  width: number;
  height: number;
  mimeType: string;
  fileSizeBytes: number;
  isPrimary: boolean;
  sortOrder: number;
  expiresAt: Date | null;
};

export function resolveCustomMockupColorRefs(input: {
  refs: string[] | ["all"];
  selectedColorIds: string[];
  storeColors: Array<{ id: string; name: string }>;
}): { colorIds: string[]; appliesToAll: boolean } {
  if (input.refs.length === 1 && input.refs[0] === "all") {
    return {
      colorIds: [...new Set(input.selectedColorIds)],
      appliesToAll: true,
    };
  }
  if (input.refs.includes("all")) {
    throw new Error('"all" cannot be combined with explicit color references');
  }

  const selected = new Set(input.selectedColorIds);
  const resolved: string[] = [];
  for (const rawRef of input.refs) {
    const ref = rawRef.trim();
    const matches = input.storeColors.filter(
      (color) =>
        color.id === ref ||
        color.name.trim().toLocaleLowerCase("en-US") === ref.toLocaleLowerCase("en-US"),
    );
    if (matches.length !== 1 || !selected.has(matches[0].id)) {
      throw new Error(`Color reference is not selected in this draft: ${ref}`);
    }
    if (!resolved.includes(matches[0].id)) resolved.push(matches[0].id);
  }

  if (resolved.length === 0) {
    throw new Error("At least one selected color reference is required");
  }
  return { colorIds: resolved, appliesToAll: false };
}

export function summarizeCustomMockupCoverage(input: {
  selectedColorIds: string[];
  sourceColorIds: string[][];
}): { coveredColorIds: string[]; missingColorIds: string[] } {
  const covered = new Set(input.sourceColorIds.flat());
  return {
    coveredColorIds: input.selectedColorIds.filter((id) => covered.has(id)),
    missingColorIds: input.selectedColorIds.filter((id) => !covered.has(id)),
  };
}
