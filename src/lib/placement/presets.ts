import { db } from "@/lib/db";
import type { PlacementPreset } from "@prisma/client";

/**
 * Get presets for a specific product type, scoped to tenant + system presets
 */
export async function getPlacementPresets(
  tenantId: string,
  productType: string,
) {
  // Fetch tenant presets + system presets (tenantId = null),
  // ordered by sortOrder
  const presets = await db.placementPreset.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      // If productType is provided, it must be in the productTypes array
      // Prisma array contains filter:
      productTypes: {
        has: productType.toLowerCase(),
      },
    },
    orderBy: [
      { tenantId: "desc" }, // Put tenant specific overrides first
      { sortOrder: "asc" },
    ],
  });

  // Deduplicate by key (tenant overrides system)
  const deduped = new Map<string, PlacementPreset>();
  for (const preset of presets) {
    if (!deduped.has(preset.key)) {
      deduped.set(preset.key, preset);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}
