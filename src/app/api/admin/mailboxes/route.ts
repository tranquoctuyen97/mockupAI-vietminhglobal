/**
 * Admin Mailbox Management — List + Create
 *
 * GET  /api/admin/mailboxes?storeId=... — List mailboxes for a store
 * POST /api/admin/mailboxes — Create mailbox (group + channel + local record)
 *
 * Access: requireMailboxAdmin() — SUPER_ADMIN or ADMIN only
 * Audit: all operations logged without credentials
 *
 * Store-scoped: mailboxes belong to stores. storeId is required.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { createMailboxSchema, MAILBOX_HISTORY_WINDOW_MONTHS } from "@/lib/zammad/admin-validation";
import { toZammadInboundSsl, toZammadOutboundSsl } from "@/lib/zammad/admin-validation";
import {
  createGroup,
  assignAdminToGroup,
  updateGroup,
  deleteGroup,
  testEmailInbound,
  testEmailOutbound,
  verifyEmailChannel,
  findChannelByGroupId,
  disableEmailChannel,
  deleteEmailChannel,
  probeEmailSettings,
  applyMailboxHistoryWindow,
  updateEmailChannelInbound,
} from "@/lib/zammad/client";
import type { ZammadInboundConfig, ZammadOutboundConfig } from "@/lib/zammad/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function validateStore(storeId: string, tenantId: string) {
  return prisma.store.findFirst({
    where: {
      id: storeId,
      tenantId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
}

async function rollbackCreatedZammadResources(channelId: number | null, groupId: number | null) {
  if (channelId) {
    await disableEmailChannel(channelId).catch((e) => {
      console.error(
        `[MAILBOX] CRITICAL: Failed to disable channel ${channelId} during rollback:`,
        e,
      );
    });
    await deleteEmailChannel(channelId).catch((e) => {
      console.error(
        `[MAILBOX] CRITICAL: Failed to delete channel ${channelId} during rollback. Manual cleanup required.`,
        e,
      );
    });
  }

  if (groupId) {
    const deleteResult = await deleteGroup(groupId).catch((e) => {
      console.error(
        `[MAILBOX] CRITICAL: Failed to delete group ${groupId} during rollback. Manual cleanup required.`,
        e,
      );
      return null;
    });
    if (!deleteResult?.ok) {
      await updateGroup(groupId, {
        name: `archived-mailbox-${groupId}-${Date.now()}`,
        active: false,
      }).catch((e) => {
        console.error(
          `[MAILBOX] CRITICAL: Failed to archive group ${groupId} during rollback. Manual cleanup required.`,
          e,
        );
      });
    }
  }
}

// ─── GET /api/admin/mailboxes?storeId=... ──────────────────────────────────────

export async function GET(request: NextRequest) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;
  const { session } = guard;

  const { searchParams } = request.nextUrl;
  const storeId = searchParams.get("storeId");

  if (!storeId) {
    return NextResponse.json(
      { error: "storeId is required" },
      { status: 422 },
    );
  }

  const store = await validateStore(storeId, session.tenantId);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const mailboxes = await prisma.mailbox.findMany({
    where: {
      tenantId: session.tenantId,
      storeId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      provider: true,
      zammadGroupId: true,
      zammadChannelId: true,
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

// ─── POST /api/admin/mailboxes ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
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

  // 2. Validate store belongs to tenant
  const store = await validateStore(input.storeId, session.tenantId);
  if (!store) {
    return NextResponse.json(
      { error: "Store not found or not active" },
      { status: 404 },
    );
  }

  let groupId: number | null = null;
  let channelId: number | null = null;

  try {
    // 3. Create Zammad group
    const groupResult = await createGroup({ name: input.name });
    if (!groupResult.ok || !groupResult.data) {
      return NextResponse.json(
        { error: "Failed to create mailbox group in email system" },
        { status: 502 },
      );
    }
    groupId = groupResult.data.id;

    // 3b. Assign admin user to the new group so API token can access its tickets
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

    // 4. Test inbound connection
    const inboundTest = await testEmailInbound(inbound);
    if (!inboundTest.ok || inboundTest.data?.result !== "ok") {
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

    // 5. Test outbound connection
    const outboundTest = await testEmailOutbound({
      ...outbound,
      email: input.email,
    });
    if (!outboundTest.ok || outboundTest.data?.result !== "ok") {
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

    // 6. Verify + create channel (may block up to 30s)
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

    // 7. Extract channelId
    const channel = await findChannelByGroupId(groupId, input.email);
    channelId = channel?.id ?? null;
    if (!channelId) {
      console.error(
        `[MAILBOX] Channel created but could not extract channelId for groupId=${groupId}`,
      );
      await deleteGroup(groupId).catch(() => {});
      return NextResponse.json(
        { error: "Failed to locate configured mailbox channel in email system" },
        { status: 502 },
      );
    }

    // 7a. Ensure keep_on_server: true is set on the email channel
    const keepOnServerResult = await updateEmailChannelInbound(channelId, { keep_on_server: true });
    if (!keepOnServerResult.ok) {
      console.error(
        `[zammad] failed to enable keep_on_server for channel=${channelId}: ${keepOnServerResult.error ?? "unknown error"}`,
      );
      await rollbackCreatedZammadResources(channelId, groupId);
      return NextResponse.json(
        {
          error: "Failed to configure safety settings for mailbox",
          details: keepOnServerResult.error ?? "Failed to set keep_on_server=true",
        },
        { status: 502 },
      );
    }
    console.info(`[zammad] keep_on_server enabled for channel=${channelId}`);

    // 7b. Apply fixed 6-month history window policy.
    // The history window is not yet implemented at the Zammad channel level;
    // this is recorded as a known limitation.
    if (channelId) {
      const historyResult = await applyMailboxHistoryWindow(channelId);
      if (!historyResult.ok) {
        console.warn(
          `[MAILBOX] History window not applied for channel ${channelId}: ${historyResult.error}`,
        );
      }
    }

    // 8. Save local Mailbox row — scoped to tenant and store
    let mailbox;
    try {
      mailbox = await prisma.mailbox.create({
        data: {
          tenantId: session.tenantId,
          storeId: input.storeId,
          name: input.name,
          email: input.email,
          provider: input.provider,
          zammadGroupId: groupId,
          zammadChannelId: channelId,
          isActive: true,
        },
      });
    } catch (dbError) {
      console.error("[MAILBOX] DB save failed, rolling back Zammad resources");
      await rollbackCreatedZammadResources(channelId, groupId);
      return NextResponse.json(
        { error: "Failed to save mailbox. Zammad resources cleaned up." },
        { status: 500 },
      );
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
        storeId: input.storeId,
        storeName: store.name,
        name: input.name,
        email: input.email,
        provider: input.provider,
        zammadGroupId: groupId,
        zammadChannelId: channelId,
        historyWindowMonths: MAILBOX_HISTORY_WINDOW_MONTHS,
      },
      ...reqInfo,
    });

    return NextResponse.json({ mailbox }, { status: 201 });
  } catch (err) {
    // Unexpected error — try to clean up
    console.error("[MAILBOX] Unexpected error during create:", err);
    await rollbackCreatedZammadResources(channelId, groupId);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
