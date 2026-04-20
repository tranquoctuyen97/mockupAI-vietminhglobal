/**
 * GET    /api/wizard/drafts/:id — Get draft + readiness checklist
 * PATCH  /api/wizard/drafts/:id — Update draft (auto-save) + trigger regen if stale
 * DELETE /api/wizard/drafts/:id — Delete draft
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDraft, updateDraft, deleteDraft } from "@/lib/wizard/state";
import { prisma } from "@/lib/db";
import { hasActiveMockupJob, regenerateMockupsForDraft } from "@/lib/mockup/regenerate";
import { validatePlacementSet } from "@/lib/placement/validate";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { PlacementData, DesignMeta } from "@/lib/placement/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const draft = await getDraft(id, session.tenantId);

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Build pre-publish checklist
  const checklist = await buildChecklist(draft);

  return NextResponse.json({ ...draft, checklist });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  try {
    const updated = await updateDraft(id, session.tenantId, body);

    // DB trigger sets mockupsStale if colors/design/placement changed.
    // After PATCH, check flag and enqueue regeneration if not already running.
    const freshDraft = await prisma.wizardDraft.findUnique({
      where: { id },
      select: { mockupsStale: true },
    });

    if (freshDraft?.mockupsStale) {
      const active = await hasActiveMockupJob(id);
      if (!active) {
        // Fire-and-forget — same pattern as initial generation
        regenerateMockupsForDraft(id).catch((err) =>
          console.error(`[PATCH] Regen failed for draft ${id}:`, err),
        );
      }
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteDraft(id, session.tenantId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}

// ── Checklist builder ────────────────────────────────────────────────────────

async function buildChecklist(draft: any) {
  const jobs = (draft.mockupJobs ?? []) as Array<{ status: string; colorName: string }>;
  const colors = (draft.selectedColors as Array<{ title: string }>) ?? [];

  // 1. Mockup count matches selected color count
  const succeededJobs = jobs.filter((j) => j.status === "SUCCEEDED");
  const mockupsMatchColors =
    colors.length > 0 && succeededJobs.length === colors.length;

  // 2. Content: title + description + tags present
  const content = draft.aiContent as {
    title?: string; description?: string; tags?: string[];
  } | null;
  const contentComplete = Boolean(
    content?.title?.trim() &&
    content?.description?.trim() &&
    (content?.tags?.length ?? 0) > 0,
  );

  // 3. Placement valid — re-use Phase 6.8 validator
  // If placement_boundary_strict flag is OFF, treat placement as valid
  let placementValid = true;
  try {
    const strictFlag = await prisma.featureFlag.findFirst({
      where: { key: "placement_boundary_strict" },
    });
    if (strictFlag?.enabled !== false) {
      const placementData: PlacementData = migratePlacementOnRead(draft.placement);
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
    // On error, treat as valid to avoid blocking publish
    placementValid = true;
  }

  // 4. Mockups not stale
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
