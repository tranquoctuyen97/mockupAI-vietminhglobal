import type { Prisma } from "@prisma/client";
import { isMockupFallbackForcedForDev } from "@/lib/config/runtime-controls";
import { prisma } from "@/lib/db";
import { applyEffectivePrintifyColorHexes } from "@/lib/designs/effective-color-hex";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import {
  assertColorFilterHasColors,
  type PairColorFilterResult,
  resolveColorFilterForDraftDesign,
} from "@/lib/mockup/pair-color-filter";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import {
  buildCustomMockupImageRows,
  buildVariantColorLookup,
} from "@/lib/mockup/printify-poll-worker";
import { getMockupCompositeQueue, getPrintifyMockupQueue } from "@/lib/mockup/queue";
import { buildListingReadyPlacementData } from "@/lib/placement/auto-place";
import { DEFAULT_PLACEMENT, DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import { getClientForStore } from "@/lib/printify/account";
import { createOrUpdatePrintifyProduct, ensurePrintifyImage } from "@/lib/printify/product";
import { sseChannels } from "@/lib/sse/channel";
import { formatTemplateMissing, getTemplateReadiness } from "@/lib/stores/template-readiness";

const DEFAULT_PLACEMENT_DATA = {
  version: "2.1",
  variants: { _default: { front: DEFAULT_PLACEMENT } },
} as const;

export class MockupGenerationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type MockupGenerationContext = Awaited<ReturnType<typeof loadMockupGenerationContext>>;

export type BatchMockupJobResult = {
  jobId: string;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
};

export type BatchMockupJobFailure = {
  draftDesignId: string | null;
  designId: string;
  designName: string;
  error: string;
};

export type PreparedMockupGeneration = {
  template: NonNullable<MockupGenerationContext["draft"]["template"]>;
  enabledVariantIds: number[];
  placementSnapshot: Prisma.InputJsonValue;
  effectivePlacementData: NonNullable<ReturnType<typeof resolveEffectivePlacementData>>;
  client: Awaited<ReturnType<typeof getClientForStore>>["client"];
  externalShopId: number;
  /** True when template.defaultMockupSource === "CUSTOM" — skips Printify upload/product/poll */
  isCustom: boolean;
  /** Cached variant-to-color lookup — avoids duplicate Printify API calls */
  variantColorLookup: Map<number, { colorName: string }>;
  /** Store colors with Printify cache hex applied, matching wizard UI grouping */
  effectiveStoreColors: NonNullable<MockupGenerationContext["draft"]["store"]>["colors"];
};

export async function loadMockupGenerationContext(draftId: string, tenantId: string) {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        where: {
          design: {
            status: "ACTIVE",
            deletedAt: null,
          },
        },
        include: { design: true },
      },
      designPairs: {
        orderBy: { sortOrder: "asc" },
        select: {
          lightDraftDesignId: true,
          darkDraftDesignId: true,
        },
      },
      template: {
        include: {
          colors: {
            include: { color: true },
          },
          mockupItems: {
            include: { mockup: true },
          },
        },
      },
      store: {
        include: {
          colors: true,
        },
      },
      mockupLibraryPicks: {
        select: { templateMockupItemId: true, isPrimary: true, sortOrder: true, compositeRegionPx: true, colorId: true },
      },
    },
  });

  if (!draft) throw new MockupGenerationError("Draft not found", 404);
  return { draft, tenantId };
}

export function resolvePrimaryDraftDesign(context: MockupGenerationContext) {
  const child = context.draft.draftDesigns[0];
  if (child) return child;
  if (!context.draft.design) {
    throw new MockupGenerationError("No design attached to draft", 400);
  }
  return {
    id: null,
    designId: context.draft.design.id,
    design: context.draft.design,
    printifyImageId: context.draft.printifyImageId,
    printifyDraftProductId: context.draft.printifyDraftProductId,
  };
}

export async function prepareMockupGeneration(
  context: MockupGenerationContext,
): Promise<PreparedMockupGeneration> {
  const { draft } = context;
  let template = draft.template;
  if (!template && draft.storeId) {
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
      include: {
        colors: {
          include: { color: true },
        },
        mockupItems: {
          include: { mockup: true },
        },
      },
    });
  }

  if (!template) {
    throw new MockupGenerationError(
      "Store chưa có Blueprint. Vào Store Settings để cấu hình.",
      400,
    );
  }

  const readiness = getTemplateReadiness(template);
  if (!readiness.ready) {
    throw new MockupGenerationError(
      `Template chưa sẵn sàng. Còn thiếu: ${formatTemplateMissing(readiness.missing)}.`,
      400,
      "TEMPLATE_NOT_READY",
      { missing: readiness.missing },
    );
  }

  const templateVariantIds = template.enabledVariantIds ?? [];
  const enabledVariantIds: number[] =
    draft.enabledVariantIdsOverride && draft.enabledVariantIdsOverride.length > 0
      ? draft.enabledVariantIdsOverride
      : templateVariantIds;

  if (enabledVariantIds.length === 0) {
    throw new MockupGenerationError("No enabled variants", 400);
  }

  if (!draft.enabledColorIds || draft.enabledColorIds.length === 0) {
    throw new MockupGenerationError("No colors selected", 400);
  }

  const isCustom = (template.defaultMockupSource ?? "PRINTIFY") === "CUSTOM";

  // For PRINTIFY templates, colors must be in template_colors.
  // For CUSTOM templates, colors link via CustomMockupSource — skip this check;
  // validateCustomMockupCoverage handles color coverage instead.
  if (!isCustom) {
    const templateColorIds = new Set(template.colors.map((entry) => entry.colorId));
    const invalidColorIds = draft.enabledColorIds.filter(
      (colorId) => !templateColorIds.has(colorId),
    );
    if (invalidColorIds.length > 0) {
      throw new MockupGenerationError(
        "Một hoặc nhiều màu đã chọn không thuộc template hiện tại. Hãy chọn lại template/màu.",
        400,
        "COLOR_NOT_IN_TEMPLATE",
      );
    }
  }

  if (isCustom) {
    await validateCustomMockupCoverage(draft, template);
  }

  const placementData = resolveEffectivePlacementData(
    draft.placementOverride,
    template.defaultPlacement,
  );
  // Fallback chain: draft override → template default → listing-ready ratio
  // default (artwork only, not the print area) → legacy fixed default.
  const primaryDesign = draft.draftDesigns[0]?.design ?? draft.design ?? null;
  const ratioDefault = primaryDesign
    ? buildListingReadyPlacementData({
        design: { widthPx: primaryDesign.width, heightPx: primaryDesign.height },
        printArea: DEFAULT_PRINT_AREA,
        template: {
          blueprintTitle: template.blueprintTitle,
          blueprintBrand: template.blueprintBrand,
        },
      })
    : null;
  const effectivePlacementData = placementData ?? ratioDefault ?? DEFAULT_PLACEMENT_DATA;
  const placementSnapshot = JSON.parse(
    JSON.stringify(effectivePlacementData),
  ) as Prisma.InputJsonValue;

  if (!isCustom && isMockupFallbackForcedForDev()) {
    throw new MockupGenerationError(
      "MOCKUP_FALLBACK_FORCE đang bật trong môi trường dev. Tắt env này để tạo Mockup chính thức bằng ảnh thật Printify.",
      409,
      "MOCKUP_FALLBACK_FORCE_ENABLED",
    );
  }

  const { client, externalShopId } = await getClientForStore(draft.storeId!);
  const variantColorLookup = await buildVariantColorLookup({
    storeId: draft.storeId!,
    draftId: draft.id,
    client,
    externalShopId,
  });
  const printifyColorHexes = await prisma.printifyVariantCache.findMany({
    where: {
      blueprintId: template.printifyBlueprintId,
      printProviderId: template.printifyPrintProviderId,
    },
    distinct: ["colorName"],
    select: { colorName: true, colorHex: true },
  });
  const effectiveStoreColors = applyEffectivePrintifyColorHexes(
    draft.store?.colors ?? [],
    printifyColorHexes,
  );

  // For Printify path only: validate that selected colors exist in Printify catalog
  if (!isCustom) {
    const availableColorNames = new Set(
      Array.from(variantColorLookup.values()).map((value) => value.colorName.trim().toLowerCase()),
    );
    const selectedColorNames =
      draft.store?.colors
        .filter((color) => draft.enabledColorIds.includes(color.id))
        .map((color) => color.name) ?? [];
    const missingColorNames = selectedColorNames.filter(
      (colorName) => !availableColorNames.has(colorName.trim().toLowerCase()),
    );

    if (missingColorNames.length > 0) {
      throw new MockupGenerationError(
        `Printify catalog không có enabled variant cho màu đã chọn: ${missingColorNames.join(", ")}`,
        400,
        "SELECTED_COLOR_HAS_NO_PRINTIFY_VARIANT",
      );
    }
  }

  return {
    template,
    enabledVariantIds,
    placementSnapshot,
    effectivePlacementData,
    client,
    externalShopId,
    isCustom,
    variantColorLookup,
    effectiveStoreColors,
  };
}

/**
 * Printify path: upload design, create Printify product, enqueue poll worker.
 * Used when template.defaultMockupSource === "PRINTIFY" (or unset).
 */
export async function createMockupJobForDraftDesign(
  context: MockupGenerationContext,
  prepared: PreparedMockupGeneration,
  draftDesign: ReturnType<typeof resolvePrimaryDraftDesign>,
): Promise<BatchMockupJobResult> {
  const { draft } = context;
  const colorFilter = getColorFilterForDraftDesign(
    context,
    draftDesign.id,
    prepared.effectiveStoreColors,
  );
  const variantIds = resolveVariantIdsForColorFilter({
    enabledVariantIds: prepared.enabledVariantIds,
    variantColorLookup: prepared.variantColorLookup,
    storeColors: prepared.effectiveStoreColors,
    colorFilter,
  });

  const imageId = await ensurePrintifyImage({
    client: prepared.client,
    designStoragePath: draftDesign.design.storagePath,
    cachedImageId: draftDesign.printifyImageId,
  });

  const product = await createOrUpdatePrintifyProduct({
    client: prepared.client,
    shopId: prepared.externalShopId,
    productId: draftDesign.printifyDraftProductId,
    blueprintId: prepared.template.printifyBlueprintId,
    printProviderId: prepared.template.printifyPrintProviderId,
    variantIds,
    imageId,
    placementData: prepared.effectivePlacementData,
    title: `[DRAFT] ${draftDesign.design.originalFilename ?? draftDesign.design.id}`,
    description: "MockupAI draft product for preview generation",
    tags: ["mockupai", "draft-preview"],
  });

  if (draftDesign.id) {
    await prisma.wizardDraftDesign.update({
      where: { id: draftDesign.id },
      data: {
        printifyImageId: imageId,
        printifyDraftProductId: product.productId,
        lastError: null,
      },
    });
  } else {
    await prisma.wizardDraft.update({
      where: { id: draft.id },
      data: {
        printifyImageId: imageId,
        printifyDraftProductId: product.productId,
      },
    });
  }

  const mockupJob = await prisma.mockupJob.create({
    data: {
      draftId: draft.id,
      draftDesignId: draftDesign.id,
      designId: draftDesign.designId,
      status: "running",
      totalImages: 0,
      placementSnapshot: prepared.placementSnapshot,
      colorFilterIds: colorFilter.colorIds as Prisma.InputJsonValue,
      colorGroup: colorFilter.colorGroup,
    },
  });

  await getPrintifyMockupQueue().add("poll-printify-mockups", {
    mockupJobId: mockupJob.id,
    draftId: draft.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    storeId: draft.storeId!,
    productId: product.productId,
    colorFilterIds: colorFilter.colorIds,
    colorGroup: colorFilter.colorGroup,
  });

  return {
    jobId: mockupJob.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    designName: draftDesign.design.name,
    status: "running",
  };
}

/**
 * Custom path: skip Printify entirely. Resolve custom mockup sources directly,
 * create MockupImage rows, enqueue COMPOSITE renders if needed.
 * Used when template.defaultMockupSource === "CUSTOM".
 *
 * Saves 30–90s and 5+ Printify API calls per design.
 */
export async function createCustomMockupJobForDraftDesign(
  context: MockupGenerationContext,
  prepared: PreparedMockupGeneration,
  draftDesign: ReturnType<typeof resolvePrimaryDraftDesign>,
): Promise<BatchMockupJobResult> {
  const { draft } = context;
  const template = prepared.template;
  const colorFilter = getColorFilterForDraftDesign(
    context,
    draftDesign.id,
    prepared.effectiveStoreColors,
  );

  // Reuse variant-color lookup from prepare step (avoids duplicate Printify API call)
  const variantColorLookup = prepared.variantColorLookup;

  // Resolve custom sources for selected colors
  const enabledColorSet = new Set(colorFilter.colorIds);
  const storeColors = prepared.effectiveStoreColors;
  const colorsById = new Map(
    storeColors.filter((c) => enabledColorSet.has(c.id)).map((c) => [c.id, { name: c.name }]),
  );
  const colorIds = [...colorsById.keys()];

  // Fetch template mockup picks for the draft, ordered by priority
  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: {
      draftId: draft.id,
      colorId: { in: colorIds },
    },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      color: true,
      templateMockupItem: {
        include: { mockup: true },
      },
    },
  });

  // Build source-like entries from picks for the custom mockup image row builder
  const pickSources = picks.map((pick) => ({
    id: pick.id,
    colorId: pick.colorId,
    label: pick.templateMockupItem.mockup.name,
    view: pick.templateMockupItem.mockup.view,
    sceneType: pick.templateMockupItem.mockup.sceneType,
    renderMode: pick.templateMockupItem.mockup.renderMode as "COMPOSITE",
    outputPath: null,
    isPrimary: pick.isPrimary,
    sortOrder: pick.sortOrder,
    templateMockupItemId: pick.templateMockupItemId,
    compositeRegionPx: pick.compositeRegionPx ?? pick.templateMockupItem.mockup.compositeRegionPx,
    storagePath: pick.templateMockupItem.mockup.storagePath,
    mockupWidth: pick.templateMockupItem.mockup.width,
    mockupHeight: pick.templateMockupItem.mockup.height,
  }));

  const draftRows = buildCustomMockupImageRows({
    sources: pickSources.map((s) => ({
      id: s.id,
      colorId: s.colorId,
      label: s.label,
      view: s.view,
      sceneType: s.sceneType,
      renderMode: s.renderMode,
      outputPath: s.outputPath,
      isPrimary: s.isPrimary,
      sortOrder: s.sortOrder,
      templateMockupItemId: s.templateMockupItemId,
    })),
    colorsById,
    variantColorLookup,
    scope: "DRAFT",
    sortOffset: 0,
  });
  const templateRows: ReturnType<typeof buildCustomMockupImageRows> = [];

  // Draft rows take priority; template rows fill gaps
  const draftColorKeys = new Set(
    draftRows.map((r) =>
      r.colorName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    ),
  );
  const rows = [
    ...draftRows,
    ...templateRows.filter(
      (r) =>
        !draftColorKeys.has(
          r.colorName
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        ),
    ),
  ];

  if (rows.length === 0) {
    throw new MockupGenerationError(
      "Không tìm thấy custom mockup nào cho các màu đã chọn.",
      400,
      "NO_CUSTOM_MOCKUP_ROWS",
    );
  }

  const completedCount = rows.filter((r) => r.compositeStatus === "completed").length;
  const hasPending = completedCount < rows.length;

  // Create the mockup job
  const mockupJob = await prisma.mockupJob.create({
    data: {
      draftId: draft.id,
      draftDesignId: draftDesign.id,
      designId: draftDesign.designId,
      status: hasPending ? "running" : "completed",
      totalImages: rows.length,
      completedImages: completedCount,
      failedImages: 0,
      placementSnapshot: prepared.placementSnapshot,
      colorFilterIds: colorFilter.colorIds as Prisma.InputJsonValue,
      colorGroup: colorFilter.colorGroup,
    },
  });

  // Write image rows
  await prisma.mockupImage.createMany({
    data: rows.map((row) => ({ mockupJobId: mockupJob.id, ...row })),
  });

  // Mark draft mockups as fresh
  await prisma.wizardDraft.update({
    where: { id: draft.id },
    data: { mockupsStale: false, mockupsStaleReason: null },
  });

  // Enqueue COMPOSITE renders for images that need it
  const pendingComposites = rows
    .map((row, i) => ({ row, idx: i }))
    .filter(({ row }) => row.compositeStatus === "pending");

  if (pendingComposites.length > 0) {
    const createdImages = await prisma.mockupImage.findMany({
      where: { mockupJobId: mockupJob.id },
      select: { id: true, sourceUrl: true, compositeStatus: true },
      orderBy: { sortOrder: "asc" },
    });
    console.log(`[generation.ts] mockupJobId: ${mockupJob.id}, createdImages count: ${createdImages.length}`);
    const pendingImages = createdImages.filter((img) => img.compositeStatus === "pending");
    console.log(`[generation.ts] mockupJobId: ${mockupJob.id}, pendingImages count: ${pendingImages.length}`);
    const compositeQueue = getMockupCompositeQueue();
    for (const image of pendingImages) {
      console.log(`[generation.ts] Enqueueing image: ${image.id}, sourceUrl: ${image.sourceUrl}`);
      await compositeQueue.add("composite-custom-mockup", {
        mockupImageId: image.id,
        sourceUrl: image.sourceUrl,
        designStoragePath: draftDesign.design.storagePath,
        placementData: {},
      });
    }
  }

  // Emit SSE progress event so frontend gets real-time update
  sseChannels.emit(draft.id, {
    type: "mockup.job.created",
    data: {
      jobId: mockupJob.id,
      draftDesignId: draftDesign.id,
      designId: draftDesign.designId,
      totalImages: rows.length,
      completedImages: completedCount,
      status: hasPending ? "running" : "completed",
      source: "custom",
    },
  });

  return {
    jobId: mockupJob.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    designName: draftDesign.design.name,
    status: hasPending ? "running" : "completed",
  };
}

function getColorFilterForDraftDesign(
  context: MockupGenerationContext,
  draftDesignId: string | null,
  storeColors = context.draft.store?.colors ?? [],
): PairColorFilterResult {
  const { draft } = context;
  const filter = resolveColorFilterForDraftDesign({
    draftDesignId,
    selectedColorIds: draft.enabledColorIds,
    storeColors,
    pairs: draft.designPairs ?? [],
  });

  assertColorFilterHasColors(filter);
  return filter;
}

function resolveVariantIdsForColorFilter(input: {
  enabledVariantIds: number[];
  variantColorLookup: Map<number, { colorName: string }>;
  storeColors: Array<{ id: string; name: string }>;
  colorFilter: PairColorFilterResult;
}): number[] {
  if (!input.colorFilter.colorGroup) return input.enabledVariantIds;

  const colorNames = new Set(
    input.storeColors
      .filter((color) => input.colorFilter.colorIds.includes(color.id))
      .map((color) => normalizeColorName(color.name)),
  );
  const variantIds = input.enabledVariantIds.filter((variantId) => {
    const variantColor = input.variantColorLookup.get(variantId);
    return variantColor && colorNames.has(normalizeColorName(variantColor.colorName));
  });

  if (variantIds.length === 0) {
    throw new MockupGenerationError(
      `No enabled variants for ${input.colorFilter.colorGroup} colors`,
      400,
      "NO_VARIANTS_FOR_COLOR_GROUP",
    );
  }

  return variantIds;
}

function normalizeColorName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function validateCustomMockupCoverage(
  draft: MockupGenerationContext["draft"],
  template: NonNullable<MockupGenerationContext["draft"]["template"]>,
) {
  const selectedColorIds = new Set(draft.enabledColorIds);
  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: {
      draftId: draft.id,
      colorId: { in: draft.enabledColorIds },
    },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      color: true,
      templateMockupItem: {
        include: { mockup: true },
      },
    },
  });

  if (picks.length === 0) {
    throw new MockupGenerationError(
      "Chưa chọn mockup nào cho listing này.",
      400,
      "NO_CUSTOM_MOCKUP_SELECTED",
    );
  }

  const coveredColorIds = new Set(picks.map((pick) => pick.colorId));
  const missingCustomColors = (draft.store?.colors ?? []).filter(
    (color) => selectedColorIds.has(color.id) && !coveredColorIds.has(color.id),
  );

  if (missingCustomColors.length > 0) {
    const missingColorNames = missingCustomColors.map((color) => color.name).join(", ");
    throw new MockupGenerationError(
      `Template đang dùng Custom nhưng ${missingColorNames} chưa có mockup custom. Màu này sẽ chưa thể tạo mockup cho tới khi bạn upload mockup custom hoặc bỏ màu này khỏi listing.`,
      400,
      "CUSTOM_MOCKUP_MISSING_COLOR",
      {
        missingColorIds: missingCustomColors.map((color) => color.id),
        missingColorNames: missingCustomColors.map((color) => color.name),
      },
    );
  }

  // For each selected color, check if it has at least one COMPOSITE source with a region.
  const pickRegionByPickId = new Map(
    picks.filter((p) => p.compositeRegionPx != null).map((p) => [p.id, p.compositeRegionPx]),
  );
  const colorIds = [...new Set(picks.map((p) => p.colorId))];
  const colorsWithNoValidRegion = colorIds.filter((colorId) => {
    const picksForColor = picks.filter(
      (p) => p.colorId === colorId && p.templateMockupItem.mockup.renderMode === "COMPOSITE",
    );
    if (picksForColor.length === 0) return false; // No COMPOSITE picks = OK
    return picksForColor.every((p) => {
      const effective = normalizeCompositeRegionPx(
        pickRegionByPickId.get(p.id) ?? p.templateMockupItem.mockup.compositeRegionPx
      );
      return !effective;
    });
  });

  if (colorsWithNoValidRegion.length > 0) {
    const missingPlacementColorNames = [
      ...new Set(
        colorsWithNoValidRegion
          .map((colorId) => draft.store?.colors.find((color) => color.id === colorId)?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    throw new MockupGenerationError(
      `Có mockup chưa chỉnh vị trí: ${missingPlacementColorNames.join(", ")}. Hãy bấm "Chỉnh vị trí design" trước khi tạo Mockups.`,
      400,
      "CUSTOM_MOCKUP_MISSING_REGION",
      {
        missingColorNames: missingPlacementColorNames,
        missingColorIds: colorsWithNoValidRegion,
      },
    );
  }
}
