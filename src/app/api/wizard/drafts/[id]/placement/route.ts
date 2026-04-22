import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatePlacement } from "@/lib/placement/validate";
import { calculateDpi } from "@/lib/placement/dpi";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { PlacementData, ViewKey } from "@/lib/placement/types";
import { z } from "zod";

const PlacementPatchSchema = z.object({
  variantKey: z.string().min(1, "variantKey is required"),
  view: z.enum(["front", "back", "sleeve_left", "sleeve_right"]),
  placement: z.object({
    xMm: z.number(),
    yMm: z.number(),
    widthMm: z.number().positive("widthMm must be positive"),
    heightMm: z.number().positive("heightMm must be positive"),
    rotationDeg: z.number().min(-360).max(360).optional(),
    lockAspect: z.boolean().optional(),
    mirrored: z.boolean().optional(),
    placementMode: z.enum(["stretch", "preserve", "exact"]).optional(),
  }),
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

    const { variantKey, view, placement: rawPlacement } = parsed.data;
    const placement = {
      xMm: rawPlacement.xMm,
      yMm: rawPlacement.yMm,
      widthMm: rawPlacement.widthMm,
      heightMm: rawPlacement.heightMm,
      rotationDeg: rawPlacement.rotationDeg ?? 0,
      lockAspect: rawPlacement.lockAspect ?? true,
      mirrored: rawPlacement.mirrored ?? false,
      placementMode: rawPlacement.placementMode ?? "preserve" as const,
    };

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
