/**
 * Mockup Regeneration Worker — Phase 6.9
 * Triggered when draft.mockupsStale = true (set by DB trigger).
 * Reuses existing in-process mockup engine (lib/mockup/worker.ts).
 *
 * Architecture note: Phase 3 uses in-process execution.
 * When BullMQ is added in a future phase, replace the enqueueMockupJobs
 * calls here with proper queue.add() calls.
 */

import { prisma } from "@/lib/db";
import { enqueueMockupJobs, type MockupJobData } from "@/lib/mockup/worker";

export type StaleReason = "colors_changed" | "design_changed" | "placement_changed";

/**
 * Check if there is currently an active (PENDING or RUNNING) mockup job for this draft.
 * Used to prevent double-enqueue when multiple PATCHes arrive quickly.
 */
export async function hasActiveMockupJob(draftId: string): Promise<boolean> {
  const active = await prisma.mockupJob.findFirst({
    where: {
      wizardDraftId: draftId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    select: { id: true },
  });
  return active !== null;
}

/**
 * Regenerate mockups when draft colors, design, or placement changed.
 *
 * Steps:
 * 1. Load draft with current design + selected colors
 * 2. Mark stale jobs (belonging to OLD colors) as FAILED with reason "superseded"
 * 3. Create new MockupJob rows for missing colors
 * 4. Enqueue processing (in-process, same as initial generation)
 * 5. Reset mockupsStale = false
 */
export async function regenerateMockupsForDraft(draftId: string): Promise<void> {
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: { design: true },
  });

  if (!draft || !draft.mockupsStale) return;
  if (!draft.design || !draft.design.storagePath) {
    console.warn(`[Regenerate] Draft ${draftId} has no design — skipping`);
    await resetStaleFlag(draftId);
    return;
  }

  const newColors = (draft.selectedColors as Array<{ title: string; hex: string }>) || [];
  const newColorNames = new Set(newColors.map((c) => c.title));

  // 1. Load existing jobs
  const existingJobs = await prisma.mockupJob.findMany({
    where: { wizardDraftId: draftId },
  });

  // 2. Supersede jobs for colors that are no longer selected
  const toSupersede = existingJobs.filter((j) => !newColorNames.has(j.colorName));
  if (toSupersede.length > 0) {
    await prisma.mockupJob.updateMany({
      where: { id: { in: toSupersede.map((j) => j.id) } },
      data: { status: "FAILED", errorMessage: "superseded_by_regenerate" },
    });
  }

  // 3. Find colors that don't have a current valid job
  const existingValidColorNames = new Set(
    existingJobs
      .filter(
        (j) =>
          newColorNames.has(j.colorName) &&
          j.errorMessage !== "superseded_by_regenerate",
      )
      .map((j) => j.colorName),
  );

  const missingColors = newColors.filter((c) => !existingValidColorNames.has(c.title));

  if (missingColors.length === 0) {
    console.log(`[Regenerate] Draft ${draftId}: no missing colors — resetting flag`);
    await resetStaleFlag(draftId);
    return;
  }

  // 4. Create new MockupJob rows for missing colors
  // Re-use templateId from first existing job (same blueprint), or default
  const templateRef = existingJobs[0];
  const templateId = templateRef?.templateId ?? "default";
  const templateName = templateRef?.templateName ?? "Default Template";

  const placementObj = (draft.placement as {
    position?: string; x?: number; y?: number; scale?: number;
  }) || {};

  const jobData: MockupJobData[] = [];

  for (const color of missingColors) {
    const created = await prisma.mockupJob.create({
      data: {
        wizardDraftId: draftId,
        colorName: color.title,
        colorHex: color.hex,
        templateId,
        templateName,
        status: "PENDING",
      },
    });

    jobData.push({
      jobId: created.id,
      draftId,
      designStoragePath: draft.design.storagePath,
      colorHex: color.hex,
      colorName: color.title,
      placement: {
        x: placementObj.x ?? 0.5,
        y: placementObj.y ?? 0.5,
        scale: placementObj.scale ?? 0.8,
        position: (placementObj.position as "FRONT") ?? "FRONT",
      },
    });
  }

  // 5. Process in background (fire-and-forget, same pattern as generate-mockups route)
  enqueueMockupJobs(draftId, jobData)
    .then(() => resetStaleFlag(draftId))
    .catch((err) => console.error(`[Regenerate] Draft ${draftId} failed:`, err));
}

async function resetStaleFlag(draftId: string) {
  // Direct SQL update to avoid triggering the stale trigger again
  // (trigger only fires on color/design/placement changes, not on mockupsStale change)
  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { mockupsStale: false, mockupsStaleReason: null },
  });
}
