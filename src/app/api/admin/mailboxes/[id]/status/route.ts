/**
 * Admin Mailbox — Enable/Disable
 *
 * POST /api/admin/mailboxes/:id/status
 *
 * No DELETE route — disable-only.
 * Store-scoped: verifies mailbox belongs to session tenant.
 */
import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { statusSchema } from "@/lib/zammad/admin-validation";
import { enableEmailChannel, disableEmailChannel } from "@/lib/zammad/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { active } = parsed.data;

  // Enable/disable Zammad channel
  if (mailbox.zammadChannelId) {
    if (active) {
      const result = await enableEmailChannel(mailbox.zammadChannelId);
      if (!result.ok) {
        return NextResponse.json(
          { error: "Failed to enable channel in email system" },
          { status: 502 },
        );
      }
    } else {
      const result = await disableEmailChannel(mailbox.zammadChannelId);
      if (!result.ok) {
        return NextResponse.json(
          { error: "Failed to disable channel in email system" },
          { status: 502 },
        );
      }
    }
  }

  // Update local record
  const updated = await prisma.mailbox.update({
    where: { id },
    data: { isActive: active },
  });

  // Audit
  const reqInfo = getRequestInfo(request);
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
    },
    ...reqInfo,
  });

  return NextResponse.json({ mailbox: updated });
}
