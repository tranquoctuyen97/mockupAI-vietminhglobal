import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import { buildVariantColorLookup } from "@/lib/mockup/printify-poll-worker";
import { printifyMockupQueue } from "@/lib/mockup/queue";
import { DEFAULT_PLACEMENT } from "@/lib/placement/types";
import {
  createOrUpdatePrintifyProduct,
  ensurePrintifyImage,
} from "@/lib/printify/product";

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
      store: {
        include: {
          template: true,
          colors: true,
        },
      },
    },
  });

  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (!draft.design) return NextResponse.json({ error: "No design attached to draft" }, { status: 400 });
  if (!draft.store?.template) {
    return NextResponse.json({ error: "Store chưa có Blueprint. Vào Store Settings để cấu hình." }, { status: 400 });
  }

  const templateVariantIds = draft.store.template.enabledVariantIds ?? [];
  const enabledVariantIds: number[] =
    draft.enabledVariantIdsOverride && draft.enabledVariantIdsOverride.length > 0
      ? draft.enabledVariantIdsOverride
      : templateVariantIds;

  if (enabledVariantIds.length === 0) {
    return NextResponse.json(
      { error: "No enabled variants" },
      { status: 400 },
    );
  }

  if (!draft.enabledColorIds || draft.enabledColorIds.length === 0) {
    return NextResponse.json(
      { error: "No colors selected" },
      { status: 400 },
    );
  }

  const placementData = resolveEffectivePlacementData(
    draft.placementOverride,
    draft.store.template.defaultPlacement,
  );
  const effectivePlacementData = placementData ?? DEFAULT_PLACEMENT_DATA;
  const placementSnapshot = JSON.parse(JSON.stringify(effectivePlacementData)) as Prisma.InputJsonValue;

  const realMockupsEnabled = await isEnabled("printify_real_mockups");
  const forcedSynthetic = await isEnabled("mockup_fallback_force");

  if (!realMockupsEnabled) {
    return NextResponse.json(
      {
        error:
          "Printify real mockups chưa được bật. Mockup chính thức yêu cầu ảnh thật từ Printify.",
        code: "PRINTIFY_REAL_MOCKUPS_DISABLED",
      },
      { status: 409 },
    );
  }

  if (forcedSynthetic) {
    return NextResponse.json(
      {
        error:
          "mockup_fallback_force đang bật. Tắt flag này để tạo Mockup chính thức bằng ảnh thật Printify.",
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
    const selectedColorNames = draft.store.colors
      .filter((color) => draft.enabledColorIds.includes(color.id))
      .map((color) => color.name);
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
      blueprintId: draft.store.template.printifyBlueprintId,
      printProviderId: draft.store.template.printifyPrintProviderId,
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

    await printifyMockupQueue.add("poll-printify-mockups", {
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
