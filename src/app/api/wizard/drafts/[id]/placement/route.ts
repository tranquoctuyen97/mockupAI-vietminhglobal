import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatePlacement } from "@/lib/placement/validate";
import { calculateDpi } from "@/lib/placement/dpi";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { Placement, PlacementData, VariantViews, ViewKey } from "@/lib/placement/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const { variantKey, view, placement } = body as {
      variantKey: string;
      view: ViewKey;
      placement: Placement;
    };

    if (!variantKey || !view || !placement) {
      return NextResponse.json(
        { error: "variantKey, view, and placement are required" },
        { status: 400 },
      );
    }

    const draft = await db.wizardDraft.findUnique({
      where: { id: draftId },
      include: { design: true },
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (!draft.design) {
      return NextResponse.json({ error: "Draft has no design" }, { status: 400 });
    }

    // 1. Get print area (fallback if not synced)
    let printArea = DEFAULT_PRINT_AREA;
    if (draft.blueprintId) {
      const dbArea = await db.blueprintPrintArea.findFirst({
        where: {
          printifyBlueprintId: draft.blueprintId,
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

    // 2. Validate placement
    const validation = validatePlacement(placement, printArea);

    // 3. Calculate DPI
    const dpi = calculateDpi(
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

    // 4. Transform and save placement data
    let placementData = draft.placement as unknown as PlacementData;
    if (!placementData || placementData.version !== 2) {
      // Migrate or initialize
      placementData = { version: 2, variants: {} };
    }

    if (!placementData.variants[variantKey]) {
      placementData.variants[variantKey] = {};
    }

    placementData.variants[variantKey][view] = placement;

    // Save to DB
    await db.wizardDraft.update({
      where: { id: draftId },
      data: {
        placement: placementData as any,
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
