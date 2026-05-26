export const MAX_WIZARD_DESIGNS = 5;

export interface DraftDesignLike {
  designId?: string | null;
}

export interface DraftWithDesignSelection {
  designId?: string | null;
  draftDesigns?: DraftDesignLike[] | null;
}

export function normalizeDesignIds(value: unknown): string[] {
  if (value == null) return [];

  if (!Array.isArray(value)) {
    throw new Error("designIds must be an array");
  }

  const seen = new Set<string>();
  const designIds: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("designIds must contain only strings");
    }

    const designId = item.trim();
    if (!designId) {
      throw new Error("designIds must contain non-empty strings");
    }

    if (seen.has(designId)) continue;

    seen.add(designId);
    designIds.push(designId);

    if (designIds.length > MAX_WIZARD_DESIGNS) {
      throw new Error(`Select up to ${MAX_WIZARD_DESIGNS} designs`);
    }
  }

  return designIds;
}

export function getDraftDesignIds(draft: DraftWithDesignSelection): string[] {
  if (draft.draftDesigns && draft.draftDesigns.length > 0) {
    return normalizeDesignIds(draft.draftDesigns.map((draftDesign) => draftDesign.designId));
  }

  return draft.designId ? normalizeDesignIds([draft.designId]) : [];
}

export function sameDesignSelection(left: unknown, right: unknown): boolean {
  const leftDesignIds = normalizeDesignIds(left);
  const rightDesignIds = normalizeDesignIds(right);

  return (
    leftDesignIds.length === rightDesignIds.length &&
    leftDesignIds.every((designId, index) => designId === rightDesignIds[index])
  );
}
