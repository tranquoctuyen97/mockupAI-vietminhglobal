/**
 * Admin Mailbox Management — List + Create
 *
 * GET  /api/admin/mailboxes — List all app-managed mailboxes
 * POST /api/admin/mailboxes — Create mailbox (group + channel + local record)
 *
 * Access: requireMailboxAdmin() — SUPER_ADMIN or ADMIN only
 * Audit: all operations logged without credentials
 */
import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { createMailboxSchema } from "@/lib/zammad/admin-validation";
import { toZammadInboundSsl, toZammadOutboundSsl } from "@/lib/zammad/admin-validation";
import {
  createGroup,
  assignAdminToGroup,
  deleteGroup,
  testEmailInbound,
  testEmailOutbound,
  verifyEmailChannel,
  findChannelByGroupId,
  updateEmailChannelInbound,
  disableEmailChannel,
  probeEmailSettings,
  redactPasswords,
} from "@/lib/zammad/client";
import type { ZammadInboundConfig, ZammadOutboundConfig } from "@/lib/zammad/types";

// ─── GET /api/admin/mailboxes ───────────────────────────────────────────────

export async function GET() {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;

  const mailboxes = await prisma.mailbox.findMany({
    orderBy: { createdAt: "desc" },
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

  // Count assigned users per mailbox
  const groupIds = mailboxes.map((m) => m.zammadGroupId);
  const accessCounts = await prisma.userMailboxAccess.groupBy({
    by: ["zammadGroupId"],
    _count: { id: true },
    where: { zammadGroupId: { in: groupIds } },
  });
  const countMap = new Map(accessCounts.map((a) => [a.zammadGroupId, a._count.id]));

  return NextResponse.json({
    mailboxes: mailboxes.map((m) => ({
      ...m,
      assignedUsers: countMap.get(m.zammadGroupId) ?? 0,
    })),
  });
}

// ─── POST /api/admin/mailboxes ──────────────────────────────────────────────

export async function POST(request: Request) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  // 1. Validate input
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
  let groupId: number | null = null;
  let channelId: number | null = null;

  try {
    // 2. Create Zammad group
    const groupResult = await createGroup({ name: input.name });
    if (!groupResult.ok || !groupResult.data) {
      return NextResponse.json(
        { error: "Failed to create mailbox group in email system" },
        { status: 502 },
      );
    }
    groupId = groupResult.data.id;

    // 2b. Assign admin user to the new group so API token can access its tickets
    const assignResult = await assignAdminToGroup(groupId);
    if (!assignResult.ok) {
      console.warn(
        `[MAILBOX] Failed to assign admin to group ${groupId}. Tickets may not be visible via API.`,
      );
    }

    // Build Zammad configs — Gmail uses probe, Custom uses manual input
    let inbound: ZammadInboundConfig;
    let outbound: ZammadOutboundConfig;

    if (input.provider === "gmail" && input.appPassword) {
      // Gmail: auto-detect settings via Zammad probe
      const probeResult = await probeEmailSettings({
        email: input.email,
        password: input.appPassword.replace(/\s/g, ""),
      });
      if (!probeResult.ok || probeResult.data?.result !== "ok" || !probeResult.data?.setting) {
        await deleteGroup(groupId).catch(() => {});
        return NextResponse.json(
          {
            error: "Gmail auto-detect failed",
            details: probeResult.data?.message_human ?? probeResult.data?.message ?? "Could not connect to Gmail. Check email and App Password.",
          },
          { status: 422 },
        );
      }
      inbound = probeResult.data.setting.inbound!;
      outbound = probeResult.data.setting.outbound!;
    } else {
      // Custom: use manual input
      inbound = {
        adapter: "imap",
        options: {
          host: input.inbound!.host,
          port: String(input.inbound!.port),
          ssl: toZammadInboundSsl(input.inbound!.encryption),
          user: input.inbound!.username,
          password: input.inbound!.password,
          folder: input.inbound!.folder ?? "inbox",
        },
      };

      outbound = {
        adapter: "smtp",
        options: {
          host: input.outbound!.host,
          port: input.outbound!.port,
          ssl: toZammadOutboundSsl(input.outbound!.encryption),
          user: input.outbound!.username,
          password: input.outbound!.password,
        },
      };
    }

    // 3. Test inbound connection
    const inboundTest = await testEmailInbound(inbound);
    if (!inboundTest.ok || inboundTest.data?.result !== "ok") {
      // Rollback: delete group
      await deleteGroup(groupId).catch(() => {});
      return NextResponse.json(
        {
          error: "Inbound connection test failed",
          details: inboundTest.data?.message_human ?? inboundTest.data?.message,
          source: "inbound",
        },
        { status: 422 },
      );
    }

    // 4. Test outbound connection
    const outboundTest = await testEmailOutbound({
      ...outbound,
      email: input.email,
    });
    if (!outboundTest.ok || outboundTest.data?.result !== "ok") {
      // Rollback: delete group
      await deleteGroup(groupId).catch(() => {});
      return NextResponse.json(
        {
          error: "Outbound connection test failed",
          details: outboundTest.data?.message_human ?? outboundTest.data?.message,
          source: "outbound",
        },
        { status: 422 },
      );
    }

    // 5. Verify + create channel (may block up to 30s)
    const verifyResult = await verifyEmailChannel({
      meta: {
        realname: input.fromName ?? input.name,
        email: input.email,
      },
      group_id: groupId,
      inbound,
      outbound,
    });

    if (!verifyResult.ok || verifyResult.data?.result !== "ok") {
      // Rollback: delete group
      await deleteGroup(groupId).catch(() => {});
      return NextResponse.json(
        {
          error: "Email verification failed",
          details: verifyResult.data?.message_human ?? verifyResult.data?.message,
          source: verifyResult.data?.source,
        },
        { status: 422 },
      );
    }

    // 6. Extract channelId
    const channel = await findChannelByGroupId(groupId, input.email);
    channelId = channel?.id ?? null;
    if (!channelId) {
      console.warn(
        `[MAILBOX] Channel created but could not extract channelId for groupId=${groupId}`,
      );
    }

    // 6b. Set import mode on the channel (keep_on_server for "new_only")
    if (channelId && input.importMode === "new_only") {
      const updateResult = await updateEmailChannelInbound(channelId, {
        keep_on_server: true,
      });
      if (!updateResult.ok) {
        console.warn(
          `[MAILBOX] Failed to set keep_on_server on channel ${channelId}. All emails may be imported.`,
        );
      }
    }

    // 7. Save local Mailbox row
    let mailbox;
    try {
      mailbox = await prisma.mailbox.create({
        data: {
          name: input.name,
          email: input.email,
          provider: input.provider,
          zammadGroupId: groupId,
          zammadChannelId: channelId,
          isActive: true,
        },
      });
    } catch (dbError) {
      // Rollback: disable channel + delete group
      console.error("[MAILBOX] DB save failed, rolling back Zammad resources");
      if (channelId) {
        await disableEmailChannel(channelId).catch((e) => {
          console.error(
            `[MAILBOX] CRITICAL: Failed to disable channel ${channelId}. Manual cleanup required.`,
            e,
          );
        });
      }
      await deleteGroup(groupId).catch((e) => {
        console.error(
          `[MAILBOX] CRITICAL: Failed to delete group ${groupId}. Manual cleanup required.`,
          e,
        );
      });
      return NextResponse.json(
        { error: "Failed to save mailbox. Zammad resources cleaned up." },
        { status: 500 },
      );
    }

    // 8. Save assignments (if provided)
    if (input.assignments && input.assignments.length > 0) {
      const accessData = input.assignments.map((a) => ({
        userId: a.userId,
        zammadGroupId: groupId!,
        mailboxName: input.name,
        canReply: a.canReply,
        canUpdateStatus: a.canUpdateStatus,
      }));

      for (const access of accessData) {
        await prisma.userMailboxAccess.upsert({
          where: {
            userId_zammadGroupId: {
              userId: access.userId,
              zammadGroupId: access.zammadGroupId,
            },
          },
          create: access,
          update: {
            canReply: access.canReply,
            canUpdateStatus: access.canUpdateStatus,
            mailboxName: access.mailboxName,
          },
        });
      }
    }

    // 9. Audit log — no credentials
    const reqInfo = getRequestInfo(request);
    await logAudit({
      actorUserId: session.id,
      tenantId: session.tenantId,
      action: "mailbox.create",
      resourceType: "mailbox",
      resourceId: mailbox.id,
      metadata: {
        name: input.name,
        email: input.email,
        provider: input.provider,
        zammadGroupId: groupId,
        zammadChannelId: channelId,
      },
      ...reqInfo,
    });

    return NextResponse.json({ mailbox }, { status: 201 });
  } catch (err) {
    // Unexpected error — try to clean up
    console.error("[MAILBOX] Unexpected error during create:", err);
    if (groupId && !channelId) {
      await deleteGroup(groupId).catch(() => {});
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
