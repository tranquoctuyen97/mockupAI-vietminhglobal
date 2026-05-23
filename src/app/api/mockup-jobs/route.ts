import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { isMockupFallbackForcedForDev } from "@/lib/config/runtime-controls";
import { prisma } from "@/lib/db";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import { resolveCustomMockupSourceSelection } from "@/lib/mockup/custom-source-selection";
import { buildVariantColorLookup } from "@/lib/mockup/printify-poll-worker";
import { getPrintifyMockupQueue } from "@/lib/mockup/queue";
import { DEFAULT_PLACEMENT } from "@/lib/placement/types";
import { createOrUpdatePrintifyProduct, ensurePrintifyImage } from "@/lib/printify/product";
import { formatTemplateMissing, getTemplateReadiness } from "@/lib/stores/template-readiness";

const DEFAULT_PLACEMENT_DATA = {
  version: "2.1",
  variants: { _default: { front: DEFAULT_PLACEMENT } },
} as const;

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { draftId } = body;

  if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });

  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: {
      design: true,
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

  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (!draft.design)
    return NextResponse.json({ error: "No design attached to draft" }, { status: 400 });

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
    return NextResponse.json(
      { error: "Store chưa có Blueprint. Vào Store Settings để cấu hình." },
      { status: 400 },
    );
  }

  const readiness = getTemplateReadiness(template);
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: `Template chưa sẵn sàng. Còn thiếu: ${formatTemplateMissing(readiness.missing)}.`,
        code: "TEMPLATE_NOT_READY",
      },
      { status: 400 },
    );
  }

  const templateVariantIds = template.enabledVariantIds ?? [];
  const enabledVariantIds: number[] =
    draft.enabledVariantIdsOverride && draft.enabledVariantIdsOverride.length > 0
      ? draft.enabledVariantIdsOverride
      : templateVariantIds;

  if (enabledVariantIds.length === 0) {
    return NextResponse.json({ error: "No enabled variants" }, { status: 400 });
  }

  if (!draft.enabledColorIds || draft.enabledColorIds.length === 0) {
    return NextResponse.json({ error: "No colors selected" }, { status: 400 });
  }

  const templateColorIds = new Set(template.colors.map((entry) => entry.colorId));
  const invalidColorIds = draft.enabledColorIds.filter((colorId) => !templateColorIds.has(colorId));
  if (invalidColorIds.length > 0) {
    return NextResponse.json(
      {
        error: "Một hoặc nhiều màu đã chọn không thuộc template hiện tại. Hãy chọn lại template/màu.",
        code: "COLOR_NOT_IN_TEMPLATE",
      },
      { status: 400 },
    );
  }

  if ((template.defaultMockupSource ?? "PRINTIFY") === "CUSTOM") {
    const selectedColorIds = new Set(draft.enabledColorIds);
    const [draftSources, templateSources] = await Promise.all([
      prisma.customMockupSource.findMany({
        where: {
          scope: "DRAFT",
          draftId,
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
      return NextResponse.json(
        {
          error: "Chưa chọn mockup nào cho listing này.",
          code: "NO_CUSTOM_MOCKUP_SELECTED",
        },
        { status: 400 },
      );
    }
    const coveredColorIds = new Set(resolvedSelection.selectedSources.map((source) => source.colorId));
    const missingCustomColors = (draft.store?.colors ?? []).filter(
      (color) => selectedColorIds.has(color.id) && !coveredColorIds.has(color.id),
    );

    if (missingCustomColors.length > 0) {
      const missingColorNames = missingCustomColors.map((color) => color.name).join(", ");
      return NextResponse.json(
        {
          error: `Template đang dùng Custom nhưng ${missingColorNames} chưa có mockup custom. Màu này sẽ chưa thể tạo mockup cho tới khi bạn upload mockup custom hoặc bỏ màu này khỏi listing.`,
          code: "CUSTOM_MOCKUP_MISSING_COLOR",
          missingColorIds: missingCustomColors.map((color) => color.id),
          missingColorNames: missingCustomColors.map((color) => color.name),
        },
        { status: 400 },
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
      return NextResponse.json(
        {
          error: `Có mockup chưa chỉnh vị trí: ${missingPlacementColorNames.join(", ")}. Hãy bấm \"Chỉnh vị trí design\" trước khi tạo Mockups.`,
          code: "CUSTOM_MOCKUP_MISSING_REGION",
          missingColorNames: missingPlacementColorNames,
          missingSourceIds: missingPlacementSources.map((source) => source.id),
        },
        { status: 400 },
      );
    }
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
    return NextResponse.json(
      {
        error:
          "MOCKUP_FALLBACK_FORCE đang bật trong môi trường dev. Tắt env này để tạo Mockup chính thức bằng ảnh thật Printify.",
        code: "MOCKUP_FALLBACK_FORCE_ENABLED",
      },
      { status: 409 },
    );
  }

  try {
    const { getClientForStore } = await import("@/lib/printify/account");
    const { client, externalShopId } = await getClientForStore(draft.storeId!);

    const variantColorLookup = await buildVariantColorLookup({
      storeId: draft.storeId!,
      draftId,
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
      return NextResponse.json(
        {
          error: `Printify catalog không có enabled variant cho màu đã chọn: ${missingColorNames.join(", ")}`,
          code: "SELECTED_COLOR_HAS_NO_PRINTIFY_VARIANT",
        },
        { status: 400 },
      );
    }

    const imageId = await ensurePrintifyImage({
      client,
      designStoragePath: draft.design.storagePath,
      cachedImageId: draft.printifyImageId,
    });

    const product = await createOrUpdatePrintifyProduct({
      client,
      shopId: externalShopId,
      productId: draft.printifyDraftProductId,
      blueprintId: template.printifyBlueprintId,
      printProviderId: template.printifyPrintProviderId,
      variantIds: enabledVariantIds,
      imageId,
      placementData: effectivePlacementData,
      title: `[DRAFT] ${draft.design.originalFilename ?? draft.id}`,
      description: "MockupAI draft product for preview generation",
      tags: ["mockupai", "draft-preview"],
    });

    await prisma.wizardDraft.update({
      where: { id: draftId },
      data: {
        printifyImageId: imageId,
        printifyDraftProductId: product.productId,
      },
    });

    const mockupJob = await prisma.mockupJob.create({
      data: {
        draftId,
        status: "running",
        totalImages: 0,
        placementSnapshot,
      },
    });

    await getPrintifyMockupQueue().add("poll-printify-mockups", {
      mockupJobId: mockupJob.id,
      draftId,
      storeId: draft.storeId!,
      productId: product.productId,
    });

    return NextResponse.json({
      jobId: mockupJob.id,
      totalImages: 0,
      status: "running",
      provider: "printify",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Printify error";
    console.error("Printify real mockup generation failed:", error);
    return NextResponse.json(
      {
        error: `Printify không tạo được mockup thật: ${message}`,
        code: "PRINTIFY_REAL_MOCKUP_FAILED",
      },
      { status: 502 },
    );
  }
}
