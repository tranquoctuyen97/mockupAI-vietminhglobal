import { resolveColorGroups, type EffectiveColorGroup } from "@/lib/designs/color-classifier";

export interface PairColorFilterPair {
  lightDraftDesignId: string;
  darkDraftDesignId: string;
}

export interface PairColorFilterColor {
  id: string;
  name?: string;
  hex: string;
  colorGroup: string;
}

export interface PairColorFilterResult {
  colorIds: string[];
  colorGroup: EffectiveColorGroup | null;
}

export function resolveColorFilterForDraftDesign(input: {
  draftDesignId: string | null;
  selectedColorIds: string[];
  storeColors: PairColorFilterColor[];
  pairs: PairColorFilterPair[];
}): PairColorFilterResult {
  if (!input.draftDesignId) {
    return { colorIds: input.selectedColorIds, colorGroup: null };
  }

  const pair = input.pairs.find(
    (candidate) =>
      candidate.lightDraftDesignId === input.draftDesignId ||
      candidate.darkDraftDesignId === input.draftDesignId,
  );
  if (!pair) {
    return { colorIds: input.selectedColorIds, colorGroup: null };
  }

  const colorGroup: EffectiveColorGroup =
    pair.lightDraftDesignId === input.draftDesignId ? "light" : "dark";
  const selectedColorIdSet = new Set(input.selectedColorIds);
  const colorGroups = resolveColorGroups(input.storeColors);
  const colorIds = input.storeColors
    .filter((color) => selectedColorIdSet.has(color.id) && colorGroups.get(color.id) === colorGroup)
    .map((color) => color.id);

  return { colorIds, colorGroup };
}

export function assertColorFilterHasColors(filter: PairColorFilterResult): void {
  if (filter.colorIds.length === 0 && filter.colorGroup) {
    throw new Error(`No ${filter.colorGroup} colors selected for paired design`);
  }
}
