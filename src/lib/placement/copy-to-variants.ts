import type { Placement, VariantViews, ViewKey } from "./types";

/**
 * Copies a placement from one view/variant to multiple others.
 * As per Phase 6.6 requirements: we copy ONLY once (no live-linking) for simplicity and safety.
 *
 * @param draftVariants The current `draft.placement.variants` object
 * @param fromVariantKey The variant key we are copying from (e.g. "black")
 * @param fromView The specific view we are copying from (e.g. "front")
 * @param targetVariantKeys List of variant keys to copy TO
 * @returns A new variants object with the placement copied
 */
export function copyPlacementOnce(
  draftVariants: Record<string, VariantViews>,
  fromVariantKey: string,
  fromView: ViewKey,
  targetVariantKeys: string[],
): Record<string, VariantViews> {
  const newVariants = { ...draftVariants };

  // Get the source placement
  const sourceView = newVariants[fromVariantKey]?.[fromView];

  // If there's nothing to copy, do nothing
  if (!sourceView) {
    return newVariants;
  }

  // Deep clone to avoid reference mutation issues
  const clonedPlacement: Placement = JSON.parse(JSON.stringify(sourceView));

  for (const targetKey of targetVariantKeys) {
    if (targetKey === fromVariantKey) continue;

    if (!newVariants[targetKey]) {
      newVariants[targetKey] = {};
    }

    // Assign the copy
    newVariants[targetKey][fromView] = JSON.parse(JSON.stringify(clonedPlacement));
  }

  return newVariants;
}
