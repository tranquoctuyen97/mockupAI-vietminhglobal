/**
 * Preset Status — async computed helper for store readiness
 * Phase 6.10: queries DB to determine which config steps are complete
 */

import { prisma } from "@/lib/db";
import { getTemplateReadiness, type TemplateMissing } from "@/lib/stores/template-readiness";

export type PresetMissing = TemplateMissing;

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
  const template = await prisma.storeMockupTemplate.findFirst({
    where: { storeId, isDefault: true },
    include: { colors: true, mockupItems: { include: { mockup: true } } },
  });

  const { missing } = getTemplateReadiness(template);
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
  mockups: "mockups",
};

/**
 * Sync version for use in listStores (when templates are already loaded via include)
 */
export function getPresetStatusSync(store: {
  templates?: Array<{
    printifyBlueprintId?: number | null;
    printifyPrintProviderId?: number | null;
    enabledVariantIds?: number[];
    defaultPlacement?: unknown;
    defaultMockupSource?: string | null;
    isDefault?: boolean;
    colors?: unknown[];
    mockupItems?: unknown[];
  }> | null;
}): PresetStatus {
  const template = store.templates?.find((t) => t.isDefault) ?? null;
  const { missing } = getTemplateReadiness(template);
  const done = TOTAL_PRESET_ITEMS - missing.length;
  return {
    ready: missing.length === 0,
    missing,
    completionPercent: Math.round((done / TOTAL_PRESET_ITEMS) * 100),
  };
}
