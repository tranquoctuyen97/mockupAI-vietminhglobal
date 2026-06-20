/**
 * Admin Mailbox — User Assignments
 *
 * GET /api/admin/mailboxes/:id/assignments — List assigned users
 * PUT /api/admin/mailboxes/:id/assignments — Bulk update assignments
 *
 * Permission rules:
 * - SUPER_ADMIN can assign anyone
 * - ADMIN can assign ADMIN/OPERATOR only (not SUPER_ADMIN)
 * - SUPER_ADMIN bypasses assignments and doesn't need to be assigned
 */
import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { assignmentsSchema } from "@/lib/zammad/admin-validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;

  const { id } = await params;
  const mailbox = await prisma.mailbox.findUnique({ where: { id } });
  if (!mailbox) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  const assignments = await prisma.userMailboxAccess.findMany({
    where: { zammadGroupId: mailbox.zammadGroupId },
    include: {
      user: {
        select: { id: true, email: true, role: true, status: true },
      },
    },
  });

  return NextResponse.json({
    assignments: assignments.map((a) => ({
      userId: a.userId,
      email: a.user.email,
      role: a.user.role,
      status: a.user.status,
      canReply: a.canReply,
      canUpdateStatus: a.canUpdateStatus,
    })),
  });
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

  const parsed = assignmentsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { assignments } = parsed.data;

  // Verify all users exist and belong to tenant
  const userIds = assignments.map((a) => a.userId);
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      tenantId: session.tenantId,
    },
    select: { id: true, role: true },
  });

  if (users.length !== userIds.length) {
    const foundIds = new Set(users.map((u) => u.id));
    const missing = userIds.filter((id) => !foundIds.has(id));
    return NextResponse.json(
      { error: "Users not found", missing },
      { status: 400 },
    );
  }

  // Permission check: ADMIN cannot assign SUPER_ADMIN
  if (session.role === "ADMIN") {
    const superAdmins = users.filter((u) => u.role === "SUPER_ADMIN");
    if (superAdmins.length > 0) {
      return NextResponse.json(
        { error: "ADMIN cannot assign SUPER_ADMIN users" },
        { status: 403 },
      );
    }
  }

  // Delete removed assignments
  const newUserIds = new Set(userIds);
  await prisma.userMailboxAccess.deleteMany({
    where: {
      zammadGroupId: mailbox.zammadGroupId,
      userId: { notIn: [...newUserIds] },
    },
  });

  // Upsert assignments
  for (const assignment of assignments) {
    await prisma.userMailboxAccess.upsert({
      where: {
        userId_zammadGroupId: {
          userId: assignment.userId,
          zammadGroupId: mailbox.zammadGroupId,
        },
      },
      create: {
        userId: assignment.userId,
        zammadGroupId: mailbox.zammadGroupId,
        mailboxName: mailbox.name,
        canReply: assignment.canReply,
        canUpdateStatus: assignment.canUpdateStatus,
      },
      update: {
        canReply: assignment.canReply,
        canUpdateStatus: assignment.canUpdateStatus,
        mailboxName: mailbox.name,
      },
    });
  }

  // Audit — no credentials
  const reqInfo = getRequestInfo(request);
  await logAudit({
    actorUserId: session.id,
    tenantId: session.tenantId,
    action: "mailbox.assign",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    metadata: {
      mailboxName: mailbox.name,
      assignedCount: assignments.length,
      userIds,
    },
    ...reqInfo,
  });

  return NextResponse.json({ success: true, assignedCount: assignments.length });
}
