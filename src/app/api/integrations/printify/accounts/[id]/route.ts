/**
 * PATCH /api/integrations/printify/accounts/:id — Rotate key or rename
 * DELETE /api/integrations/printify/accounts/:id — Delete account
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { rotatePrintifyKey, deletePrintifyAccount, LinkedStoresError } from "@/lib/printify/account";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Verify account belongs to tenant
  const account = await prisma.printifyAccount.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const body = await request.json();
  const { apiKey, nickname } = body as { apiKey?: string; nickname?: string };

  try {
    // Rotate key if provided
    if (apiKey?.trim()) {
      await rotatePrintifyKey(id, apiKey.trim());

      const reqInfo = getRequestInfo(request);
      await logAudit({
        tenantId: session.tenantId,
        actorUserId: session.id,
        action: "printify_account.rotated",
        resourceType: "printify_account",
        resourceId: id,
        metadata: { nickname: account.nickname },
        ...reqInfo,
      });
    }

    // Update nickname if provided
    if (nickname?.trim() && nickname.trim() !== account.nickname) {
      await prisma.printifyAccount.update({
        where: { id },
        data: { nickname: nickname.trim() },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Verify account belongs to tenant
  const account = await prisma.printifyAccount.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  try {
    await deletePrintifyAccount(id);

    const reqInfo = getRequestInfo(_request);
    await logAudit({
      tenantId: session.tenantId,
      actorUserId: session.id,
      action: "printify_account.deleted",
      resourceType: "printify_account",
      resourceId: id,
      metadata: { nickname: account.nickname },
      ...reqInfo,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof LinkedStoresError) {
      return NextResponse.json(
        { error: error.message, linkedStores: error.stores },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
