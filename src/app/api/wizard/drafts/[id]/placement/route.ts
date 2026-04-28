import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatePlacement } from "@/lib/placement/validate";
import { calculateDpi } from "@/lib/placement/dpi";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import { PlacementSchema, ViewKeySchema } from "@/lib/placement/schema";
import { normalizePlacementData, setPlacementForView } from "@/lib/placement/views";
import { z } from "zod";

const PlacementPatchSchema = z.object({
  variantKey: z.string().min(1, "variantKey is required"),
  view: ViewKeySchema,
  placement: PlacementSchema.nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const parsed = PlacementPatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { view, placement: rawPlacement } = parsed.data;
    const placement = rawPlacement
      ? {
          xMm: rawPlacement.xMm,
          yMm: rawPlacement.yMm,
          widthMm: rawPlacement.widthMm,
          heightMm: rawPlacement.heightMm,
          rotationDeg: rawPlacement.rotationDeg ?? 0,
          lockAspect: rawPlacement.lockAspect ?? true,
          mirrored: rawPlacement.mirrored ?? false,
          placementMode: rawPlacement.placementMode ?? "preserve" as const,
          presetKey: rawPlacement.presetKey,
        }
      : null;

    const draft = await db.wizardDraft.findUnique({
      where: { id: draftId },
      include: { design: true, store: { include: { template: true } } },
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (placement && !draft.design) {
      return NextResponse.json({ error: "Draft has no design" }, { status: 400 });
    }

    // 1. Get print area (fallback if not synced)
    let printArea = DEFAULT_PRINT_AREA;
    if (draft.store?.template?.printifyBlueprintId) {
      const dbArea = await db.blueprintPrintArea.findFirst({
        where: {
          printifyBlueprintId: draft.store.template.printifyBlueprintId,
          position: view.toUpperCase() as any, // Simple mapping for now
        },
      });
      if (dbArea) {
        printArea = {
          widthMm: dbArea.widthMm,
          heightMm: dbArea.heightMm,
          safeMarginMm: dbArea.safeMarginMm,
        };
      }
    }

    let validation = null;
    let dpi = null;
    if (placement && draft.design) {
      // 2. Validate placement
      validation = validatePlacement(placement, printArea);

      // 3. Calculate DPI
      dpi = calculateDpi(
        {
          widthPx: draft.design.width,
          heightPx: draft.design.height,
          dpi: draft.design.dpi,
        },
        placement,
      );

      // If there is any ERROR severity, we block saving (Client should prevent this too)
      // For DPI < 150, user said "only warn", so we do not block. But if validatePlacement returns valid: false, we stop.
      if (!validation.valid) {
        return NextResponse.json(
          { error: "Invalid placement", details: validation.errors },
          { status: 400 },
        );
      }
    }

    // 4. Transform and save placement data
    const basePlacementData = draft.placementOverride ?? draft.store?.template?.defaultPlacement;
    const placementData = setPlacementForView(
      normalizePlacementData(basePlacementData, true),
      view,
      placement,
    );

    // Save to DB
    await db.wizardDraft.update({
      where: { id: draftId },
      data: {
        placementOverride: placementData as any,
      },
    });

    return NextResponse.json({
      success: true,
      validation,
      dpi,
      placementData,
    });
  } catch (error) {
    console.error(`PATCH /api/wizard/drafts/placement error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
