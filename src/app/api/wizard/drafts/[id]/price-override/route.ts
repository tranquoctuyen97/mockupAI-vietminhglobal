/**
 * PUT /api/wizard/drafts/:id/price-override
 * Save per-size retail price overrides to WizardDraft.priceBySizeOverride
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: { id: true },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  let body: { priceBySizeOverride?: Record<string, number> | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const override = body.priceBySizeOverride;

  // null or undefined → clear override
  if (override == null) {
    await prisma.wizardDraft.update({
      where: { id: draftId },
      data: { priceBySizeOverride: null },
    });
    return NextResponse.json({ ok: true, priceBySizeOverride: null });
  }

  // Validate: must be a plain object with string keys and positive number values
  if (typeof override !== "object" || Array.isArray(override)) {
    return NextResponse.json(
      { error: "priceBySizeOverride must be an object { sizeName: priceUSD }" },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  for (const [size, price] of Object.entries(override)) {
    if (!size.trim()) {
      errors.push("Size name cannot be empty");
    }
    if (typeof price !== "number" || !Number.isFinite(price)) {
      errors.push(`Price for "${size}" must be a finite number`);
    } else if (price < 1.0) {
      errors.push(`Price for "${size}" must be at least $1.00 (Printify minimum)`);
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { priceBySizeOverride: override },
  });

  return NextResponse.json({ ok: true, priceBySizeOverride: override });
}
