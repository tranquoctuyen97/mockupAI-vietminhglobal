/**
 * Admin Mailbox — Detail + Update
 *
 * GET  /api/admin/mailboxes/:id — Get mailbox detail (no passwords)
 * PUT  /api/admin/mailboxes/:id — Update mailbox (name, email, connection settings)
 */
import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { updateMailboxSchema, toZammadInboundSsl, toZammadOutboundSsl } from "@/lib/zammad/admin-validation";
import { updateGroup, verifyEmailChannel, redactPasswords } from "@/lib/zammad/client";
import type { ZammadInboundConfig, ZammadOutboundConfig } from "@/lib/zammad/types";

const ZAMMAD_MASK = "**********";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      provider: true,
      zammadGroupId: true,
      zammadChannelId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!mailbox) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  // Count assigned users
  const assignedUsers = await prisma.userMailboxAccess.count({
    where: { zammadGroupId: mailbox.zammadGroupId },
  });

  return NextResponse.json({ mailbox: { ...mailbox, assignedUsers } });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findUnique({ where: { id } });
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

  // Update Zammad group name if changed
  if (input.name && input.name !== mailbox.name) {
    const groupResult = await updateGroup(mailbox.zammadGroupId, { name: input.name });
    if (!groupResult.ok) {
      return NextResponse.json(
        { error: "Failed to update group name in email system" },
        { status: 502 },
      );
    }
  }

  // If connection settings changed, re-verify channel
  if ((input.inbound || input.outbound) && mailbox.zammadChannelId) {
    const inbound: ZammadInboundConfig = {
      adapter: "imap",
      options: {
        host: input.inbound?.host ?? "",
        port: String(input.inbound?.port ?? 993),
        ssl: toZammadInboundSsl(input.inbound?.encryption ?? "ssl"),
        user: input.inbound?.username ?? "",
        // Blank password = keep existing → send Zammad mask
        password: input.inbound?.password || ZAMMAD_MASK,
        folder: input.inbound?.folder ?? "inbox",
      },
    };

    const outbound: ZammadOutboundConfig = {
      adapter: "smtp",
      options: {
        host: input.outbound?.host ?? "",
        port: input.outbound?.port ?? 587,
        ssl: toZammadOutboundSsl(input.outbound?.encryption ?? "starttls"),
        user: input.outbound?.username ?? "",
        // Blank password = keep existing → send Zammad mask
        password: input.outbound?.password || ZAMMAD_MASK,
      },
    };

    const verifyResult = await verifyEmailChannel({
      meta: {
        realname: input.fromName ?? input.name ?? mailbox.name,
        email: input.email ?? mailbox.email,
      },
      group_id: mailbox.zammadGroupId,
      channel_id: mailbox.zammadChannelId,
      inbound,
      outbound,
    });

    if (!verifyResult.ok || verifyResult.data?.result !== "ok") {
      return NextResponse.json(
        {
          error: "Email verification failed",
          details: verifyResult.data?.message_human ?? verifyResult.data?.message,
          source: verifyResult.data?.source,
        },
        { status: 422 },
      );
    }
  }

  // Update local record
  const updated = await prisma.mailbox.update({
    where: { id },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.email && { email: input.email }),
    },
  });

  // Audit — no credentials in log
  const reqInfo = getRequestInfo(request);
  await logAudit({
    actorUserId: session.id,
    tenantId: session.tenantId,
    action: "mailbox.update",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    metadata: {
      name: input.name,
      email: input.email,
      connectionChanged: !!(input.inbound || input.outbound),
    },
    ...reqInfo,
  });

  return NextResponse.json({ mailbox: updated });
}
