import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { encrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { removeRuntimeSecret } from "@/lib/mailboxes/credentials";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";
import { verifyGmailSmtp } from "@/lib/mailboxes/gmail-smtp";
import { removeMailboxJobs } from "@/lib/mailboxes/queue";
import { removeRuntimeMailboxConfigs } from "@/lib/mailboxes/runtime-config";
import { updateMailboxSchema } from "@/lib/mailboxes/validation";
import { disableQueue } from "@/lib/rt/client";
import { provisionMailbox } from "@/lib/rt/provisioning";

const DEFAULT_RUNTIME_DIR = process.env.MAILBOX_RUNTIME_DIR ?? "/run/mockupai-mailboxes";

function cleanAppPassword(value: string): string {
  return value.replace(/\s/g, "");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      name: true,
      email: true,
      provider: true,
      rtQueueId: true,
      syncStatus: true,
      lastSyncAt: true,
      lastSyncErrorCode: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      store: { select: { id: true, name: true } },
    },
  });

  if (!mailbox) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  return NextResponse.json({ mailbox });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = updateMailboxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const data: {
    name?: string;
    appPasswordEncrypted?: Uint8Array<ArrayBuffer>;
    encryptionKeyId?: string;
    syncStatus?: "PROVISIONING";
    lastSyncErrorCode?: null;
  } = {};

  if (input.name) data.name = input.name;

  if (input.appPassword) {
    const appPassword = cleanAppPassword(input.appPassword);
    const credentials = { email: mailbox.email, appPassword };
    const smtp = await verifyGmailSmtp(credentials);
    if (!smtp.ok) {
      return NextResponse.json(
        {
          result: "failed",
          error: smtp.error,
          message_human:
            smtp.error === "gmail_auth_failed"
              ? "Gmail từ chối đăng nhập. Kiểm tra App Password."
              : "Không thể kết nối Gmail SMTP. Vui lòng thử lại sau.",
        },
        { status: 422 },
      );
    }
    try {
      await createGmailAdapter(credentials).probe();
    } catch {
      return NextResponse.json(
        {
          result: "failed",
          error: "gmail_imap_unavailable",
          message_human: "Không thể kết nối Gmail IMAP. Kiểm tra IMAP và App Password.",
        },
        { status: 422 },
      );
    }
    const encrypted = encrypt(appPassword);
    data.appPasswordEncrypted = encrypted.encrypted;
    data.encryptionKeyId = encrypted.keyId;
    data.syncStatus = "PROVISIONING";
    data.lastSyncErrorCode = null;
  }

  const updated = await prisma.mailbox.update({
    where: { id },
    data,
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

  let finalMailbox = updated;
  if (input.appPassword) {
    await provisionMailbox(mailbox.id);
    finalMailbox = await prisma.mailbox.findUnique({
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
    action: "mailbox.update",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    metadata: {
      storeId: mailbox.storeId,
      name: input.name,
      credentialChanged: Boolean(input.appPassword),
    },
    ...getRequestInfo(request),
  });

  return NextResponse.json({ mailbox: finalMailbox });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, rtQueueId: true },
  });
  if (!mailbox) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  if (mailbox.rtQueueId) {
    await disableQueue(mailbox.rtQueueId).catch(() => undefined);
  }
  await Promise.all([
    removeMailboxJobs(mailbox.id).catch(() => undefined),
    removeRuntimeSecret(mailbox.id, DEFAULT_RUNTIME_DIR).catch(() => undefined),
    removeRuntimeMailboxConfigs(mailbox.id, DEFAULT_RUNTIME_DIR).catch(() => undefined),
  ]);

  await prisma.mailbox.deleteMany({ where: { id, tenantId: session.tenantId } });

  await logAudit({
    actorUserId: session.id,
    tenantId: session.tenantId,
    action: "mailbox.delete",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    ...getRequestInfo(_request),
  });

  return new NextResponse(null, { status: 204 });
}
