import { PRODUCT_DEFAULTS } from "@/lib/config/runtime-controls";
import { resolveColorGroups, type EffectiveColorGroup } from "@/lib/designs/color-classifier";
import { getLatestJobByDraftDesignId } from "@/lib/mockup/multi-design";
import { isRealPrintifyMockupMedia } from "@/lib/mockup/real-printify-media";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import { validatePlacementSet } from "@/lib/placement/validate";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { PlacementData, DesignMeta } from "@/lib/placement/types";

export async function buildChecklist(draft: any) {
  const selectedColorIds = new Set((draft.enabledColorIds ?? []) as string[]);
  const selectedColors = ((draft.store?.colors ?? []) as Array<{ id: string; name: string; hex: string; colorGroup?: string }>)
    .filter((color) => selectedColorIds.has(color.id));
  const selectedDraftDesignKeys = getChecklistDesignKeys(draft);
  const latestJobsByDesign = getLatestJobByDraftDesignId(
    (draft.mockupJobs ?? []) as Array<{
      id: string;
      draftDesignId?: string | null;
      designId?: string | null;
      createdAt: Date | string;
      status: string;
      images?: Array<{
        colorName: string;
        included: boolean;
        compositeUrl?: string | null;
        sourceUrl?: string | null;
      }>;
    }>,
  );

  const requireRealPrintifyMockups = PRODUCT_DEFAULTS.mockup.requireRealPrintifyMockups;

  // Pair-aware checklist: when design pairs exist, validate per-pair mockup coverage
  const designPairs: Array<{
    id: string;
    baseName: string;
    lightDraftDesignId: string;
    darkDraftDesignId: string;
    aiContent?: { title?: string } | null;
  }> = Array.isArray(draft.designPairs) ? draft.designPairs : [];
  const hasPairs = designPairs.length > 0;

  // Resolve effective color groups when pairs exist
  let effectiveColorGroups: Map<string, EffectiveColorGroup> | null = null;
  if (hasPairs && selectedColors.length > 0) {
    effectiveColorGroups = resolveColorGroups(
      selectedColors.map((c) => ({
        id: c.id,
        hex: c.hex,
        colorGroup: (c as any).colorGroup ?? "auto",
      })),
    );
  }

  let mockupsMatchColors: boolean;

  if (hasPairs) {
    // Each pair needs completed mockup jobs for both light and dark draft designs
    mockupsMatchColors =
      selectedColors.length > 0 &&
      designPairs.every((pair) => {
        // Check light design job covers light colors
        const lightJob = latestJobsByDesign.get(pair.lightDraftDesignId);
        const darkJob = latestJobsByDesign.get(pair.darkDraftDesignId);

        if (!lightJob || lightJob.status.toLowerCase() !== "completed") return false;
        if (!darkJob || darkJob.status.toLowerCase() !== "completed") return false;

        // If we have color groups, validate color coverage per side
        if (effectiveColorGroups) {
          const lightColorNames = selectedColors
            .filter((c) => effectiveColorGroups!.get(c.id) === "light")
            .map((c) => normalizeColorName(c.name));
          const darkColorNames = selectedColors
            .filter((c) => effectiveColorGroups!.get(c.id) === "dark")
            .map((c) => normalizeColorName(c.name));

          const lightMockupColors = new Set(
            (lightJob.images ?? [])
              .filter((img) => img.included && (!requireRealPrintifyMockups || isRealPrintifyMockup(img)))
              .map((img) => normalizeColorName(img.colorName)),
          );
          const darkMockupColors = new Set(
            (darkJob.images ?? [])
              .filter((img) => img.included && (!requireRealPrintifyMockups || isRealPrintifyMockup(img)))
              .map((img) => normalizeColorName(img.colorName)),
          );

          const lightCovered = lightColorNames.every((name) => lightMockupColors.has(name));
          const darkCovered = darkColorNames.every((name) => darkMockupColors.has(name));
          return lightCovered && darkCovered;
        }

        return true;
      });
  } else {
    // Legacy single-design checklist
    mockupsMatchColors =
      selectedColors.length > 0 &&
      selectedDraftDesignKeys.length > 0 &&
      selectedDraftDesignKeys.every((draftDesignKey) => {
        const latestJob = latestJobsByDesign.get(draftDesignKey);
        if (!latestJob || latestJob.status.toLowerCase() !== "completed") return false;

        const includedImages = (latestJob.images ?? [])
          .filter((image) => image.included)
          .filter((image) => !requireRealPrintifyMockups || isRealPrintifyMockup(image));

        const colorsWithMockup = new Set(
          includedImages.map((image) => normalizeColorName(image.colorName)),
        );

        return selectedColors.every((color) => colorsWithMockup.has(normalizeColorName(color.name)));
      });
  }

  // Content completeness: pair-aware
  let contentComplete: boolean;
  if (hasPairs) {
    // Every pair must have aiContent.title
    contentComplete = designPairs.every((pair) => {
      const pairContent = pair.aiContent as { title?: string } | null;
      return Boolean(pairContent?.title?.trim());
    });
  } else {
    const content = draft.aiContent as {
      title?: string;
      description?: string;
      tags?: string[];
    } | null;
    contentComplete = Boolean(content?.title?.trim());
  }

  // Pairing completeness: no unpaired designs when pairs exist
  let pairingComplete = true;
  if (hasPairs) {
    const totalDraftDesigns = Array.isArray(draft.draftDesigns) ? draft.draftDesigns.length : 0;
    // Each pair uses 2 draft designs
    pairingComplete = totalDraftDesigns === designPairs.length * 2;
  }

  // Color group balance: when pairs exist, must have at least one light and one dark color
  let colorGroupsBalanced = true;
  if (hasPairs && effectiveColorGroups) {
    const hasLight = selectedColors.some((c) => effectiveColorGroups!.get(c.id) === "light");
    const hasDark = selectedColors.some((c) => effectiveColorGroups!.get(c.id) === "dark");
    colorGroupsBalanced = hasLight && hasDark;
  }

  let placementValid = true;
  try {
    if (PRODUCT_DEFAULTS.placement.boundaryStrict) {
      const template = draft.template || draft.store?.templates?.find((t: any) => t.isDefault) || null;
      const placementData: PlacementData = migratePlacementOnRead(
        draft.placementOverride ?? template?.defaultPlacement,
      );
      
      // Clamp small negative coordinates (< 5mm) to 0 to prevent minor drag/drop imprecisions 
      // from triggering outside_print_area validation errors.
      clampNegativeCoords(placementData);

      const design = draft.design as { width: number; height: number; dpi: number | null } | null;
      if (design) {
        const designMeta: DesignMeta = {
          widthPx: design.width,
          heightPx: design.height,
          dpi: design.dpi,
        };
        const violations = validatePlacementSet(placementData, DEFAULT_PRINT_AREA, designMeta);
        placementValid = !violations.some((v) => v.severity === "error");
      }
    }
  } catch {
    placementValid = false;
  }

  const mockupsNotStale = !draft.mockupsStale;
  const readyToPublish =
    mockupsMatchColors &&
    contentComplete &&
    placementValid &&
    mockupsNotStale &&
    pairingComplete &&
    colorGroupsBalanced;

  return {
    mockupsMatchColors,
    contentComplete,
    placementValid,
    mockupsNotStale,
    pairingComplete,
    colorGroupsBalanced,
    readyToPublish,
  };
}

function normalizeColorName(value: string): string {
  return value.trim().toLowerCase();
}

function getChecklistDesignKeys(draft: any): string[] {
  type DraftDesignEntry = {
    id?: string | null;
    designId?: string | null;
    sortOrder?: number | null;
  };

  const draftDesigns: DraftDesignEntry[] = Array.isArray(draft?.draftDesigns) ? draft.draftDesigns : [];

  if (draftDesigns.length > 0) {
    return draftDesigns
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((entry) => entry.id ?? entry.designId ?? "")
      .filter((value): value is string => Boolean(value.trim()));
  }

  return typeof draft?.designId === "string" && draft.designId.trim() ? [draft.designId.trim()] : [];
}

function isRealPrintifyMockup(image: { compositeUrl?: string | null; sourceUrl?: string | null }): boolean {
  if (
    image.sourceUrl?.startsWith("mockup://custom/") ||
    image.sourceUrl?.startsWith("mockup://custom-") ||
    image.sourceUrl?.startsWith("mockup://library/")
  ) {
    return true;
  }
  return isRealPrintifyMockupMedia(image);
}

function clampNegativeCoords(data: PlacementData): void {
  const TOLERANCE = 5; // mm tolerance for minor editor drag/drop offsets
  if (!data?.variants) return;
  for (const views of Object.values(data.variants)) {
    for (const viewKey of Object.keys(views) as Array<keyof typeof views>) {
      const p = views[viewKey];
      if (!p) continue;
      if (p.xMm < 0 && p.xMm > -TOLERANCE) {
        p.xMm = 0;
      }
      if (p.yMm < 0 && p.yMm > -TOLERANCE) {
        p.yMm = 0;
      }
    }
  }
}
