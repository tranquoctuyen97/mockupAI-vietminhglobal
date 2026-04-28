/**
 * Preset Status — async computed helper for store readiness
 * Phase 6.10: queries DB to determine which config steps are complete
 */

import { prisma } from "@/lib/db";
import { getEnabledViews, normalizePlacementData } from "@/lib/placement/views";

export type PresetMissing =
  | "blueprint"
  | "provider"
  | "variants"
  | "colors"
  | "placement";

export interface PresetStatus {
  ready: boolean;
  missing: PresetMissing[];
  completionPercent: number; // 0-100
}

const TOTAL_PRESET_ITEMS = 5;

/**
 * Compute store preset readiness by querying template + colors
 */
export async function computePresetStatus(storeId: string): Promise<PresetStatus> {
  const [template, colorCount] = await Promise.all([
    prisma.storeMockupTemplate.findUnique({ where: { storeId } }),
    prisma.storeColor.count({ where: { storeId, enabled: true } }),
  ]);

  const missing: PresetMissing[] = [];

  if (!template?.printifyBlueprintId) missing.push("blueprint");
  if (!template?.printifyPrintProviderId) missing.push("provider");
  if (!template?.enabledVariantIds?.length) missing.push("variants");
  if (colorCount === 0) missing.push("colors");

  const placementFilled = Boolean(
    template?.defaultPlacement &&
    getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length > 0,
  );
  if (!placementFilled) missing.push("placement");

  const done = TOTAL_PRESET_ITEMS - missing.length;
  return {
    ready: missing.length === 0,
    missing,
    completionPercent: Math.round((done / TOTAL_PRESET_ITEMS) * 100),
  };
}

/**
 * Map missing item → config tab key for jump links
 */
export const MISSING_TO_TAB: Record<PresetMissing, string> = {
  blueprint: "blueprint",
  provider: "blueprint",
  variants: "blueprint",
  colors: "colors",
  placement: "placement",
};

/**
 * Sync version for use in listStores (when template is already loaded via include)
 */
export function getPresetStatusSync(store: {
  template?: {
    printifyBlueprintId?: number | null;
    printifyPrintProviderId?: number | null;
    enabledVariantIds?: number[];
    defaultPlacement?: unknown;
  } | null;
  colors?: { enabled?: boolean }[];
}): PresetStatus {
  const template = store.template;
  const enabledColors = store.colors?.filter(c => c.enabled !== false) ?? [];
  const missing: PresetMissing[] = [];

  if (!template?.printifyBlueprintId) missing.push("blueprint");
  if (!template?.printifyPrintProviderId) missing.push("provider");
  if (!template?.enabledVariantIds?.length) missing.push("variants");
  if (enabledColors.length === 0) missing.push("colors");

  const placementFilled = Boolean(
    template?.defaultPlacement &&
    getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length > 0,
  );
  if (!placementFilled) missing.push("placement");

  const done = TOTAL_PRESET_ITEMS - missing.length;
  return {
    ready: missing.length === 0,
    missing,
    completionPercent: Math.round((done / TOTAL_PRESET_ITEMS) * 100),
  };
}
