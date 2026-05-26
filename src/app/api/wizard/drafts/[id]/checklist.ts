import { PRODUCT_DEFAULTS } from "@/lib/config/runtime-controls";
import { getLatestJobByDraftDesignId } from "@/lib/mockup/multi-design";
import { isRealPrintifyMockupMedia } from "@/lib/mockup/real-printify-media";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import { validatePlacementSet } from "@/lib/placement/validate";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { PlacementData, DesignMeta } from "@/lib/placement/types";

export async function buildChecklist(draft: any) {
  const selectedColorIds = new Set((draft.enabledColorIds ?? []) as string[]);
  const selectedColors = ((draft.store?.colors ?? []) as Array<{ id: string; name: string }>)
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
  const mockupsMatchColors =
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

  const content = draft.aiContent as {
    title?: string;
    description?: string;
    tags?: string[];
  } | null;
  const contentComplete = Boolean(
    content?.title?.trim() &&
    content?.description?.trim() &&
    (content?.tags?.length ?? 0) > 0,
  );

  let placementValid = true;
  try {
    if (PRODUCT_DEFAULTS.placement.boundaryStrict) {
      const template = draft.template || draft.store?.templates?.find((t: any) => t.isDefault) || null;
      const placementData: PlacementData = migratePlacementOnRead(
        draft.placementOverride ?? template?.defaultPlacement,
      );
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
    mockupsMatchColors && contentComplete && placementValid && mockupsNotStale;

  return {
    mockupsMatchColors,
    contentComplete,
    placementValid,
    mockupsNotStale,
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
  if (image.sourceUrl?.startsWith("mockup://custom/") || image.sourceUrl?.startsWith("mockup://custom-")) {
    return true;
  }
  return isRealPrintifyMockupMedia(image);
}
