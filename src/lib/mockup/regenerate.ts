/**
 * Mockup Regeneration Worker — Phase 6.9 -> 6.11 Update
 * Triggered when draft.mockupsStale = true (set by DB trigger).
 * In Phase 6.11, mockup generation is explicit via step 3 UI.
 * This is kept as a stub to prevent build errors.
 */

import { prisma } from "@/lib/db";

export type StaleReason = "colors_changed" | "design_changed" | "placement_changed";

export async function hasActiveMockupJob(draftId: string): Promise<boolean> {
  const active = await prisma.mockupJob.findFirst({
    where: {
      draftId: draftId,
      status: { in: ["PENDING", "RUNNING", "pending", "running"] },
    },
    select: { id: true },
  });
  return active !== null;
}

export async function regenerateMockupsForDraft(draftId: string): Promise<void> {
  // Mockup generation is now explicit in Step 3. 
  // Stale drafts will just prompt the user to hit "Tạo Mockups" again.
  await resetStaleFlag(draftId);
}

async function resetStaleFlag(draftId: string) {
  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { mockupsStale: false, mockupsStaleReason: null },
  });
}
