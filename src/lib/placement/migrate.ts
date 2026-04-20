/**
 * Migrate placement data from v2 (Phase 6.6) to v2.1 (Phase 6.7)
 * Strategy: migrate-on-read — inject defaults when loading, bump version on first save.
 */
import type { Placement, PlacementData, VariantViews, ViewKey } from "./types";
import { VIEW_KEYS } from "./types";

const V2_DEFAULTS: Pick<Placement, "lockAspect" | "placementMode" | "mirrored"> = {
  lockAspect: true,
  placementMode: "preserve",
  mirrored: false,
};

/**
 * Takes raw placement data (possibly v2) and ensures all placements have v2.1 fields.
 * Does NOT modify the version field — that happens on save.
 * Returns a new object (immutable).
 */
export function migratePlacementOnRead(raw: unknown): PlacementData {
  // Not even an object → fresh v2.1
  if (!raw || typeof raw !== "object") {
    return { version: "2.1", variants: {} };
  }

  const data = raw as Record<string, unknown>;

  // Already v2.1 — pass through
  if (data.version === "2.1") {
    return data as unknown as PlacementData;
  }

  // v2 → inject defaults into every placement
  const variants = (data.variants as Record<string, VariantViews>) || {};
  const migratedVariants: Record<string, VariantViews> = {};

  for (const [variantKey, views] of Object.entries(variants)) {
    const migratedViews: VariantViews = {};

    for (const viewKey of VIEW_KEYS) {
      const placement = views[viewKey];
      if (!placement) continue;

      migratedViews[viewKey] = {
        ...V2_DEFAULTS,
        ...placement, // existing fields take precedence if already present
      };
    }

    migratedVariants[variantKey] = migratedViews;
  }

  // Keep version as 2 until user saves (then page will bump to "2.1")
  return {
    version: data.version as PlacementData["version"],
    variants: migratedVariants,
  };
}

/**
 * Stamp version to "2.1" before saving.
 * Call this when the user makes any edit on step-3 after migration.
 */
export function stampV2_1(placementData: PlacementData): PlacementData {
  return { ...placementData, version: "2.1" };
}
