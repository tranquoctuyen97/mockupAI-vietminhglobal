import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatePlacementSet } from "@/lib/placement/validate";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { DesignMeta, PlacementData } from "@/lib/placement/types";

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
      include: { design: true },
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (!draft.design) {
      return NextResponse.json({ error: "Draft has no design" }, { status: 400 });
    }

    // 1. Read feature flag — boundary_strict off → downgrade all errors to warn
    const boundaryStrictFlag = await db.featureFlag.findFirst({
      where: { key: "placement_boundary_strict" },
    });
    const isBoundaryStrict = boundaryStrictFlag?.enabled !== false; // default on

    // 2. Migrate placement on-read
    const placementData: PlacementData = migratePlacementOnRead(draft.placement);

    // 3. Resolve print area (use first-variant active view; finalize against FRONT as default)
    let printArea = DEFAULT_PRINT_AREA;
    if (draft.blueprintId) {
      const dbArea = await db.blueprintPrintArea.findFirst({
        where: { printifyBlueprintId: draft.blueprintId, position: "FRONT" as any },
      });
      if (dbArea) {
        printArea = {
          widthMm: dbArea.widthMm,
          heightMm: dbArea.heightMm,
          safeMarginMm: dbArea.safeMarginMm,
        };
      }
    }

    // 4. Design meta for DPI check
    const design: DesignMeta = {
      widthPx: draft.design.width,
      heightPx: draft.design.height,
      dpi: draft.design.dpi,
    };

    // 5. Run full validation
    const allViolations = validatePlacementSet(placementData, printArea, design);

    // 6. Apply boundary_strict flag (downgrade errors → warn when flag is off)
    const violations = isBoundaryStrict
      ? allViolations
      : allViolations.map((v) => ({ ...v, severity: "warn" as const }));

    const errors = violations.filter((v) => v.severity === "error");
    const warnings = violations.filter((v) => v.severity === "warn");

    // 7. Block on errors
    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, errors, warnings },
        { status: 422 },
      );
    }

    // 8. Warn-only path: if FE has not acknowledged, return 200 + warnings so FE can show confirm
    if (warnings.length > 0 && !body.acknowledge_warnings) {
      return NextResponse.json({ ok: false, requiresAcknowledge: true, warnings });
    }

    // 9. All clear — mark step as complete
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
