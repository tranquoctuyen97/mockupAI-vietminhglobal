/**
 * GET    /api/wizard/drafts/:id — Get draft + readiness checklist
 *        ?expand=sizes — Bundle size data for step-5
 * PATCH  /api/wizard/drafts/:id — Update draft (auto-save) + trigger regen if stale
 * DELETE /api/wizard/drafts/:id — Delete draft
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getDraft, updateDraft, deleteDraft } from "@/lib/wizard/state";
import { getClientForStore } from "@/lib/printify/account";
import { ensureVariantCostCache, groupSizes } from "@/lib/printify/variant-catalog";
import { hasActiveMockupJob, regenerateMockupsForDraft } from "@/lib/mockup/regenerate";
import { buildChecklist } from "./checklist";

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

  // Parse ?expand=sizes for step-5 data bundling
  const url = new URL(request.url);
  const expandParam = url.searchParams.get("expand") ?? "";
  const expandSet = new Set(expandParam.split(",").map((s) => s.trim()).filter(Boolean));

  // Run checklist + expansions in parallel
  const [checklist, sizesData] = await Promise.all([
    buildChecklist(draft),

    // Expand: sizes with cost data from variant cache
    expandSet.has("sizes") && draft.storeId
      ? (async () => {
          try {


            const template =
              draft.template ??
              draft.store?.templates?.find((t) => t.isDefault) ??
              null;
            if (!template) return null;

            const { client, externalShopId } = await getClientForStore(draft.storeId!);
            const variants = await ensureVariantCostCache({
              client,
              shopId: externalShopId,
              blueprintId: template.printifyBlueprintId,
              printProviderId: template.printifyPrintProviderId,
            });
            return { sizes: groupSizes(variants) };
          } catch (err) {
            console.error(`[GET drafts/${id}] sizes expand failed:`, err);
            return null;
          }
        })()
      : Promise.resolve(undefined),
  ]);

  const response: Record<string, unknown> = { ...draft, checklist };
  if (sizesData !== undefined) response.sizes = sizesData;

  return NextResponse.json(response);
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[PATCH /api/wizard/drafts/${id}] Error:`, message, err);
    if (message === "Draft not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message, code: "UPDATE_FAILED" }, { status: 422 });
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
