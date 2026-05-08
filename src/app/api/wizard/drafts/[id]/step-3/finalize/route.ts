import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatePlacementSet } from "@/lib/placement/validate";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { DesignMeta, PlacementData } from "@/lib/placement/types";
import { normalizePlacementData } from "@/lib/placement/views";

/**
 * POST /api/wizard/drafts/:id/step-3/finalize
 * Validates all cross-variant placements before allowing Step 4 transition.
 *
 * Body: { acknowledge_warnings?: boolean }
 *
 * Returns:
 *   422 — error-severity violations (outside_print_area, size_too_small)
 *   200 — ok (with optional warnings[] if acknowledge_warnings=true was sent)
 *   200 — warning-only when no errors, FE must confirm then re-call with acknowledge_warnings=true
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json().catch(() => ({})) as { acknowledge_warnings?: boolean };

    const draft = await db.wizardDraft.findUnique({
      where: { id: draftId },
      include: { design: true, store: { include: { template: true } } },
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (!draft.design) {
      return NextResponse.json({ error: "Draft has no design" }, { status: 400 });
    }

    // 1. Migrate placement on-read. If the draft has no override, validate the store preset.
    const placementData: PlacementData = normalizePlacementData(
      migratePlacementOnRead(draft.placementOverride ?? draft.store?.template?.defaultPlacement),
      true,
    );

    // 2. Resolve print area (use first-variant active view; finalize against FRONT as default)
    let printArea = DEFAULT_PRINT_AREA;
    if (draft.store?.template?.printifyBlueprintId) {
      const dbArea = await db.blueprintPrintArea.findFirst({
        where: { printifyBlueprintId: draft.store.template.printifyBlueprintId, position: "FRONT" as any },
      });
      if (dbArea) {
        printArea = {
          widthMm: dbArea.widthMm,
          heightMm: dbArea.heightMm,
          safeMarginMm: dbArea.safeMarginMm,
        };
      }
    }

    // 3. Design meta for DPI check
    const design: DesignMeta = {
      widthPx: draft.design.width,
      heightPx: draft.design.height,
      dpi: draft.design.dpi,
    };

    // 4. Run full strict validation. Seller-facing publish must not bypass placement errors.
    const violations = validatePlacementSet(placementData, printArea, design);

    const errors = violations.filter((v) => v.severity === "error");
    const warnings = violations.filter((v) => v.severity === "warn");

    // 5. Block on errors
    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, errors, warnings },
        { status: 422 },
      );
    }

    // 6. Warn-only path: if FE has not acknowledged, return 200 + warnings so FE can show confirm
    if (warnings.length > 0 && !body.acknowledge_warnings) {
      return NextResponse.json({ ok: false, requiresAcknowledge: true, warnings });
    }

    // 7. All clear — mark step as complete
    await db.wizardDraft.update({
      where: { id: draftId },
      data: {
        currentStep: Math.max(draft.currentStep ?? 3, 4), // advance to step 4
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, warnings });
  } catch (error) {
    console.error("POST step-3/finalize error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
