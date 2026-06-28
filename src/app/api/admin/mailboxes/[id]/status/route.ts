import { NextResponse } from "next/server";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import { toggleMailboxStatusSchema } from "@/lib/mailboxes/validation";
import { disableProvisionedMailbox, provisionMailbox } from "@/lib/rt/provisioning";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!mailbox) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = toggleMailboxStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { active } = parsed.data;
  let updated = await prisma.mailbox.update({
    where: { id },
    data: {
      isActive: active,
      syncStatus: active ? "PROVISIONING" : "DISABLED",
      lastSyncErrorCode: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      provider: true,
      rtQueueId: true,
      syncStatus: true,
      lastSyncAt: true,
      lastSyncErrorCode: true,
      isActive: true,
      storeId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (active) {
    await provisionMailbox(mailbox.id);
    updated = await prisma.mailbox.findUnique({
      where: { id: mailbox.id },
      select: {
        id: true,
        name: true,
        email: true,
        provider: true,
        rtQueueId: true,
        syncStatus: true,
        lastSyncAt: true,
        lastSyncErrorCode: true,
        isActive: true,
        storeId: true,
        createdAt: true,
        updatedAt: true,
      },
    }) ?? updated;
  } else {
    await disableProvisionedMailbox(mailbox.id);
    updated = await prisma.mailbox.findUnique({
      where: { id: mailbox.id },
      select: {
        id: true,
        name: true,
        email: true,
        provider: true,
        rtQueueId: true,
        syncStatus: true,
        lastSyncAt: true,
        lastSyncErrorCode: true,
        isActive: true,
        storeId: true,
        createdAt: true,
        updatedAt: true,
      },
    }) ?? updated;
  }

  await logAudit({
    actorUserId: session.id,
    tenantId: session.tenantId,
    action: active ? "mailbox.enable" : "mailbox.disable",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    metadata: {
      storeId: mailbox.storeId,
      name: mailbox.name,
      email: mailbox.email,
      syncStatus: updated.syncStatus,
    },
    ...getRequestInfo(request),
  });

  return NextResponse.json({ mailbox: updated });
}
