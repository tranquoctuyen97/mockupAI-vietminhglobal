import { PlacementData, ViewKey, Placement } from "./types";

/**
 * Resolver — centralized logic for choosing correct placement.
 * Phase 6.10 (Option C): always returns view-level placement.
 * Phase 8+ (Option B): will check imageOverrides first.
 */
export function resolvePlacement(
  data: PlacementData,
  view: ViewKey,
  mockupImageId?: string
): Placement | null {
  const variantViews =
    data.variants.default ??
    data.variants._default ??
    data.variants[Object.keys(data.variants)[0]];

  const viewPlacement = variantViews?.[view];
  if (!viewPlacement) return null;

  // Option B future: check imageOverrides
  if (mockupImageId && viewPlacement.imageOverrides?.[mockupImageId]) {
    return { ...viewPlacement, ...viewPlacement.imageOverrides[mockupImageId] };
  }

  // Option C default: view-level placement
  const { imageOverrides, ...placement } = viewPlacement;
  return placement as Placement;
}
