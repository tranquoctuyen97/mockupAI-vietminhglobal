export interface WizardDraftDesignLike {
  id: string;
  designId?: string | null;
  aiContent?: unknown | null;
  design?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

export interface WizardDesignPairLike {
  id: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
  aiContent?: unknown | null;
}

export function getPairedDraftDesignIds(
  designPairs: readonly WizardDesignPairLike[] | null | undefined,
): Set<string> {
  return new Set(
    (designPairs ?? []).flatMap((pair) => [pair.lightDraftDesignId, pair.darkDraftDesignId]),
  );
}

export function getIndependentDraftDesigns<T extends WizardDraftDesignLike>(
  draftDesigns: readonly T[] | null | undefined,
  designPairs: readonly WizardDesignPairLike[] | null | undefined,
): T[] {
  const pairedIds = getPairedDraftDesignIds(designPairs);
  return (draftDesigns ?? []).filter((draftDesign) => !pairedIds.has(draftDesign.id));
}

export function formatListingSummaryLabel(pairCount: number, independentCount: number): string {
  const total = pairCount + independentCount;
  const parts: string[] = [];
  if (pairCount > 0) parts.push(`${pairCount} cặp`);
  if (independentCount > 0) parts.push(`${independentCount} đơn`);
  return `${total} listings (${parts.join(", ")})`;
}

export function formatContentChecklistLabel(pairCount: number, independentCount: number): string {
  const parts: string[] = [];
  if (pairCount > 0) parts.push(`${pairCount} cặp`);
  if (independentCount > 0) parts.push(`${independentCount} đơn`);
  return parts.length > 0 ? `Nội dung đầy đủ cho ${parts.join(" + ")}` : "Nội dung đầy đủ (title)";
}

export function hasAiTitle(content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  const title = (content as { title?: unknown }).title;
  return typeof title === "string" && title.trim().length > 0;
}
