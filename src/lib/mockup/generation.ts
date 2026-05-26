import type { Prisma } from "@prisma/client";
import { isMockupFallbackForcedForDev } from "@/lib/config/runtime-controls";
import { prisma } from "@/lib/db";
import { resolveCustomMockupSourceSelection } from "@/lib/mockup/custom-source-selection";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import { buildVariantColorLookup } from "@/lib/mockup/printify-poll-worker";
import { getPrintifyMockupQueue } from "@/lib/mockup/queue";
import { DEFAULT_PLACEMENT } from "@/lib/placement/types";
import { createOrUpdatePrintifyProduct, ensurePrintifyImage } from "@/lib/printify/product";
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
  client: Awaited<ReturnType<typeof import("@/lib/printify/account").getClientForStore>>["client"];
  externalShopId: number;
};

export async function loadMockupGenerationContext(draftId: string, tenantId: string) {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: { design: true },
      },
      template: {
        include: {
          colors: {
            include: { color: true },
          },
        },
      },
      store: {
        include: {
          colors: true,
        },
      },
      mockupLibraryPicks: {
        select: { sourceId: true, isPrimary: true, sortOrder: true },
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
      },
    });
  }

  if (!template) {
    throw new MockupGenerationError("Store chưa có Blueprint. Vào Store Settings để cấu hình.", 400);
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

  const templateColorIds = new Set(template.colors.map((entry) => entry.colorId));
  const invalidColorIds = draft.enabledColorIds.filter((colorId) => !templateColorIds.has(colorId));
  if (invalidColorIds.length > 0) {
    throw new MockupGenerationError(
      "Một hoặc nhiều màu đã chọn không thuộc template hiện tại. Hãy chọn lại template/màu.",
      400,
      "COLOR_NOT_IN_TEMPLATE",
    );
  }

  if ((template.defaultMockupSource ?? "PRINTIFY") === "CUSTOM") {
    await validateCustomMockupCoverage(draft, template);
  }

  const placementData = resolveEffectivePlacementData(
    draft.placementOverride,
    template.defaultPlacement,
  );
  const effectivePlacementData = placementData ?? DEFAULT_PLACEMENT_DATA;
  const placementSnapshot = JSON.parse(
    JSON.stringify(effectivePlacementData),
  ) as Prisma.InputJsonValue;

  if (isMockupFallbackForcedForDev()) {
    throw new MockupGenerationError(
      "MOCKUP_FALLBACK_FORCE đang bật trong môi trường dev. Tắt env này để tạo Mockup chính thức bằng ảnh thật Printify.",
      409,
      "MOCKUP_FALLBACK_FORCE_ENABLED",
    );
  }

  const { getClientForStore } = await import("@/lib/printify/account");
  const { client, externalShopId } = await getClientForStore(draft.storeId!);
  const variantColorLookup = await buildVariantColorLookup({
    storeId: draft.storeId!,
    draftId: draft.id,
    client,
    externalShopId,
  });
  const availableColorNames = new Set(
    Array.from(variantColorLookup.values()).map((value) => value.colorName.trim().toLowerCase()),
  );
  const selectedColorNames = draft.store?.colors
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

  return {
    template,
    enabledVariantIds,
    placementSnapshot,
    effectivePlacementData,
    client,
    externalShopId,
  };
}

export async function createMockupJobForDraftDesign(
  context: MockupGenerationContext,
  prepared: PreparedMockupGeneration,
  draftDesign: ReturnType<typeof resolvePrimaryDraftDesign>,
): Promise<BatchMockupJobResult> {
  const { draft } = context;
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
    variantIds: prepared.enabledVariantIds,
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
    },
  });

  await getPrintifyMockupQueue().add("poll-printify-mockups", {
    mockupJobId: mockupJob.id,
    draftId: draft.id,
    storeId: draft.storeId!,
    productId: product.productId,
  });

  return {
    jobId: mockupJob.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    designName: draftDesign.design.name,
    status: "running",
  };
}

async function validateCustomMockupCoverage(draft: MockupGenerationContext["draft"], template: NonNullable<MockupGenerationContext["draft"]["template"]>) {
  const selectedColorIds = new Set(draft.enabledColorIds);
  const [draftSources, templateSources] = await Promise.all([
    prisma.customMockupSource.findMany({
      where: {
        scope: "DRAFT",
        draftId: draft.id,
        colorId: { in: draft.enabledColorIds },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        colorId: true,
        isPrimary: true,
        sortOrder: true,
        renderMode: true,
        compositeRegionPx: true,
      },
    }),
    prisma.customMockupSource.findMany({
      where: {
        scope: "TEMPLATE",
        templateId: template.id,
        colorId: { in: draft.enabledColorIds },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        colorId: true,
        isPrimary: true,
        sortOrder: true,
        renderMode: true,
        compositeRegionPx: true,
      },
    }),
  ]);
  const resolvedSelection = resolveCustomMockupSourceSelection({
    sources: [...draftSources, ...templateSources],
    picks: draft.mockupLibraryPicks,
  });
  if (resolvedSelection.selectedSources.length === 0) {
    throw new MockupGenerationError(
      "Chưa chọn mockup nào cho listing này.",
      400,
      "NO_CUSTOM_MOCKUP_SELECTED",
    );
  }

  const coveredColorIds = new Set(resolvedSelection.selectedSources.map((source) => source.colorId));
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

  const missingPlacementSources = resolvedSelection.selectedSources.filter(
    (source) => source.renderMode === "COMPOSITE" && !source.compositeRegionPx,
  );
  if (missingPlacementSources.length > 0) {
    const missingPlacementColorNames = [
      ...new Set(
        missingPlacementSources
          .map((source) => draft.store?.colors.find((color) => color.id === source.colorId)?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    throw new MockupGenerationError(
      `Có mockup chưa chỉnh vị trí: ${missingPlacementColorNames.join(", ")}. Hãy bấm "Chỉnh vị trí design" trước khi tạo Mockups.`,
      400,
      "CUSTOM_MOCKUP_MISSING_REGION",
      {
        missingColorNames: missingPlacementColorNames,
        missingSourceIds: missingPlacementSources.map((source) => source.id),
      },
    );
  }
}
