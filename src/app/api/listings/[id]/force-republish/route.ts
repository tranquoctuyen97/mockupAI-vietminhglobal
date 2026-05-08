/**
 * POST /api/listings/:id/force-republish
 * Delete listing record and reset draft so user can publish again.
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: listingId } = await params;

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, tenantId: session.tenantId },
    select: { id: true, wizardDraftId: true },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (!listing.wizardDraftId) {
    return NextResponse.json({ error: "Listing không liên kết với wizard draft" }, { status: 400 });
  }

  // Delete listing (cascades to variants + publishJobs)
  await prisma.listing.delete({ where: { id: listingId } });

  // Reset draft so publish route can create a new listing
  await prisma.wizardDraft.update({
    where: { id: listing.wizardDraftId },
    data: { status: "READY" },
  });

  return NextResponse.json({ ok: true });
}
