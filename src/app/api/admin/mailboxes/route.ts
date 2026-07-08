import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { encrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";
import { verifyGmailSmtp } from "@/lib/mailboxes/gmail-smtp";
import { enqueueMailboxBackfill, enqueueMailboxSync } from "@/lib/mailboxes/queue";
import { createMailboxSchema } from "@/lib/mailboxes/validation";
import { provisionMailbox } from "@/lib/rt/provisioning";

const INITIAL_SYNC_WINDOW_MONTHS = 4;

async function validateStore(storeId: string, tenantId: string) {
  return prisma.store.findFirst({
    where: { id: storeId, tenantId, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
  });
}

function cleanAppPassword(value: string): string {
  return value.replace(/\s/g, "");
}

function initialSyncAfter(): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - INITIAL_SYNC_WINDOW_MONTHS);
  return date;
}

export async function GET(request: NextRequest) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const storeId = request.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId is required" }, { status: 422 });
  }

  const store = await validateStore(storeId, session.tenantId);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const mailboxes = await prisma.mailbox.findMany({
    where: { tenantId: session.tenantId, storeId },
    orderBy: { createdAt: "desc" },
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

  return NextResponse.json({
    mailboxes,
    store: { id: store.id, name: store.name },
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createMailboxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const store = await validateStore(input.storeId, session.tenantId);
  if (!store) {
    return NextResponse.json({ error: "Store not found or not active" }, { status: 404 });
  }

  const appPassword = cleanAppPassword(input.appPassword);
  const credentials = { email: input.email, appPassword };

  const smtp = await verifyGmailSmtp(credentials);
  if (!smtp.ok) {
    return NextResponse.json(
      {
        result: "failed",
        error: smtp.error,
        message_human:
          smtp.error === "gmail_auth_failed"
            ? "Gmail từ chối đăng nhập. Kiểm tra email và App Password."
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
  const mailbox = await prisma.mailbox.create({
    data: {
      tenantId: session.tenantId,
      storeId: input.storeId,
      name: input.name,
      email: input.email,
      provider: "gmail",
      appPasswordEncrypted: encrypted.encrypted,
      encryptionKeyId: encrypted.keyId,
      initialSyncAfter: initialSyncAfter(),
      syncStatus: "PROVISIONING",
      isActive: true,
      syncCursor: { create: {} },
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

  const provisioned = await provisionMailbox(mailbox.id);
  if (provisioned.status === "ACTIVE") {
    await Promise.all([
      enqueueMailboxBackfill(mailbox.id),
      enqueueMailboxSync(mailbox.id),
    ]);
  }
  const finalMailbox = await prisma.mailbox.findUnique({
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
  });

  await logAudit({
    actorUserId: session.id,
    tenantId: session.tenantId,
    action: "mailbox.create",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    metadata: {
      storeId: input.storeId,
      name: input.name,
      email: input.email,
      provider: "gmail",
      syncStatus: finalMailbox?.syncStatus ?? mailbox.syncStatus,
      provisioned: provisioned.status,
    },
    ...getRequestInfo(request),
  });

  return NextResponse.json({ mailbox: finalMailbox ?? mailbox }, { status: 201 });
}
