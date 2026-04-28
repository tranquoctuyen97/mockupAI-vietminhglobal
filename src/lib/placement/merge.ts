/**
 * Placement merge — Phase 6.10
 *
 * Copy store template's default placement into a new wizard draft.
 * Full copy (not delta) — keeps DB trigger simple and debugging easy.
 */

import type { StoreMockupTemplate } from "@prisma/client";
import type { PlacementData } from "@/lib/placement/types";
import { DEFAULT_PLACEMENT, DEFAULT_PRINT_AREA } from "@/lib/placement/types";

/**
 * Create a PlacementData v2.1 snapshot from a store's template preset.
 *
 * If the template has a defaultPlacement JSONB, return it as-is.
 * If not, build a default placement centered on the front face.
 *
 * @returns PlacementData v2.1 shape ready to store in wizard_drafts.placement
 */
export function copyStorePreset(
  template: StoreMockupTemplate | null,
): PlacementData {
  // Template has full PlacementData v2.1 JSONB — clone it
  if (template?.defaultPlacement) {
    // Deep clone to avoid shared references between draft and store
    return JSON.parse(JSON.stringify(template.defaultPlacement)) as PlacementData;
  }

  // No preset — build a reasonable default (centered front)
  return {
    version: "2.1",
    variants: {
      _default: {
        front: { ...DEFAULT_PLACEMENT },
        back: null,
        sleeve_left: null,
        sleeve_right: null,
        neck_label: null,
        hem: null,
      },
    },
  };
}

/**
 * Convert old-style StoreMockupTemplate offset fields to PlacementData v2.1.
 * Used during migration if template has legacy placementOffsetX/Y/Scale but no JSONB yet.
 */
export function legacyOffsetToPlacementData(
  offsetXMm: number | null,
  offsetYMm: number | null,
  scalePercent: number | null,
): PlacementData {
  const scale = (scalePercent ?? 100) / 100;
  const widthMm = DEFAULT_PRINT_AREA.widthMm * scale;
  const heightMm = DEFAULT_PRINT_AREA.heightMm * scale;

  return {
    version: "2.1",
    variants: {
      _default: {
        front: {
          xMm: offsetXMm ?? DEFAULT_PLACEMENT.xMm,
          yMm: offsetYMm ?? DEFAULT_PLACEMENT.yMm,
          widthMm,
          heightMm,
          rotationDeg: 0,
          lockAspect: true,
          placementMode: "preserve",
          mirrored: false,
        },
        back: null,
        sleeve_left: null,
        sleeve_right: null,
        neck_label: null,
        hem: null,
      },
    },
  };
}
