/**
 * Admin Mailbox — Detail + Update
 *
 * GET  /api/admin/mailboxes/:id — Get mailbox detail (no passwords)
 * PUT  /api/admin/mailboxes/:id — Update mailbox (name, email, connection settings)
 *
 * Store-scoped: verifies mailbox belongs to session tenant.
 */
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import {
  toZammadInboundSsl,
  toZammadOutboundSsl,
  updateMailboxSchema,
} from "@/lib/zammad/admin-validation";
import {
  ensureSystemAddressSenderFormat,
  updateEmailChannelInbound,
  updateGroup,
  verifyEmailChannel,
} from "@/lib/zammad/client";
import type { ZammadInboundConfig, ZammadOutboundConfig } from "@/lib/zammad/types";

const ZAMMAD_MASK = "**********";

function mailboxDisplayName(name: string | undefined, email: string): string {
  return name?.trim() || email;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      id,
      tenantId: session.tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      name: true,
      email: true,
      provider: true,
      zammadGroupId: true,
      zammadChannelId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      store: {
        select: { id: true, name: true },
      },
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
    where: {
      id,
      tenantId: session.tenantId,
    },
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
  const outboundIdentity = {
    displayName: mailboxDisplayName(
      input.fromName ?? input.name ?? mailbox.name,
      input.email ?? mailbox.email,
    ),
    email: input.email ?? mailbox.email,
  };

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
        realname: outboundIdentity.displayName,
        email: outboundIdentity.email,
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

  const senderFormatResult = await ensureSystemAddressSenderFormat();
  if (!senderFormatResult.ok) {
    console.error(
      `[zammad] failed to set sender format to SystemAddressName for channel=${mailbox.zammadChannelId ?? "none"}: ${senderFormatResult.error ?? "unknown error"}`,
    );
    return NextResponse.json(
      {
        error: "Failed to configure outbound mailbox identity",
        details: senderFormatResult.error ?? "Failed to set Zammad sender format",
      },
      { status: 502 },
    );
  }
  console.info("[zammad] sender format set to SystemAddressName");

  // Ensure keep_on_server: true is set on the email channel
  if (mailbox.zammadChannelId) {
    const keepOnServerResult = await updateEmailChannelInbound(
      mailbox.zammadChannelId,
      { keep_on_server: true },
      outboundIdentity,
    );
    if (!keepOnServerResult.ok) {
      console.error(
        `[zammad] failed to enable keep_on_server for channel=${mailbox.zammadChannelId}: ${keepOnServerResult.error ?? "unknown error"}`,
      );
      return NextResponse.json(
        {
          error: "Failed to configure safety settings for mailbox",
          details: keepOnServerResult.error ?? "Failed to set keep_on_server=true",
        },
        { status: 502 },
      );
    }
    console.info(`[zammad] keep_on_server enabled for channel=${mailbox.zammadChannelId}`);
  }

  // Update local record (does not allow moving mailbox between stores)
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
      storeId: mailbox.storeId,
      name: input.name,
      email: input.email,
      connectionChanged: !!(input.inbound || input.outbound),
    },
    ...reqInfo,
  });

  return NextResponse.json({ mailbox: updated });
}
