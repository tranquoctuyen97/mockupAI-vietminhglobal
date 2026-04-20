/**
 * POST /api/listings/:id/retry-printify — Retry Printify stage
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

import { runPrintifyStage } from "@/lib/publish/worker";
import { getStorage } from "@/lib/storage/local-disk";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { variants: true, publishJobs: true },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (listing.status !== "PARTIAL_FAILURE") {
    return NextResponse.json(
      { error: "Can only retry Printify for partial_failure listings" },
      { status: 400 },
    );
  }

  // Load draft for blueprint info
  const draft = listing.wizardDraftId
    ? await prisma.wizardDraft.findUnique({
        where: { id: listing.wizardDraftId },
        include: { design: true, mockupJobs: true },
      })
    : null;

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 400 });
  }

  // Get store + Printify connection (Phase 6.5: workspace-level)
  const store = await prisma.store.findUnique({
    where: { id: listing.storeId },
  });

  let printifyApiKey: string;
  try {
    const { getClientForStore } = await import("@/lib/printify/account");
    const result = await getClientForStore(listing.storeId);
    printifyApiKey = (result.client as any).apiKey;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Printify not linked" }, { status: 400 });
  }

  // Reset Printify job
  const printifyJob = listing.publishJobs.find((j) => j.stage === "PRINTIFY");
  if (printifyJob) {
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "PENDING", lastError: null },
    });
  }

  const storage = getStorage();
  const channelId = `publish:${listing.id}`;

  // Run async
  runPrintifyStage(listing.id, listing, draft, store, printifyApiKey, storage, false, channelId).catch(
    (err) => console.error("[RetryPrintify] Error:", err),
  );

  return NextResponse.json({ ok: true, status: "retrying" });
}
