import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  mergeOptimizedTags,
  normalizeOrganizationCollections,
} from "@/lib/wizard/product-organization";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; designId: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, designId } = await params;
  const draftDesign = await prisma.wizardDraftDesign.findFirst({
    where: {
      id: designId,
      draftId,
      draft: { tenantId: session.tenantId },
    },
    select: { id: true },
  });

  if (!draftDesign) {
    return NextResponse.json({ error: "Draft design not found" }, { status: 404 });
  }

  const body = await request.json();
  const aiContent = {
    title: String(body.title ?? ""),
    description: String(body.description ?? ""),
    tags: mergeOptimizedTags([], Array.isArray(body.tags) ? body.tags : []),
    collections: normalizeOrganizationCollections(
      Array.isArray(body.collections) ? body.collections : [],
    ),
    altText: String(body.altText ?? ""),
    source: body.source === "manual" ? "manual" : "ai",
  };

  const updated = await prisma.wizardDraftDesign.update({
    where: { id: designId },
    data: { aiContent },
  });

  return NextResponse.json({ draftDesign: updated });
}
