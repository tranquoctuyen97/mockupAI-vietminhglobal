import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { revokeAllSessions } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { z } from "zod";

const roleSchema = z.object({
  role: z.enum(["ADMIN", "OPERATOR"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session: currentUser, response } = await requireFeature("users");
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = roleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (id === currentUser.id) {
      return NextResponse.json(
        { error: "Không thể thay đổi role của chính mình" },
        { status: 400 },
      );
    }

    const targetUser = await prisma.user.findFirst({
      where: { id, tenantId: currentUser.tenantId },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User không tồn tại" }, { status: 404 });
    }

    if (targetUser.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Không thể thay đổi role của SUPER_ADMIN" },
        { status: 403 },
      );
    }

    const { role: newRole } = parsed.data;

    await prisma.user.update({
      where: { id },
      data: { role: newRole },
    });

    // Revoke sessions so the user re-authenticates with the new role
    await revokeAllSessions(id);

    const { ipAddress, userAgent } = getRequestInfo(request);
    await logAudit({
      tenantId: currentUser.tenantId,
      actorUserId: currentUser.id,
      action: "user.role_changed",
      resourceType: "user",
      resourceId: id,
      metadata: {
        targetEmail: targetUser.email,
        oldRole: targetUser.role,
        newRole,
      },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN/USERS] Role change error:", error);
    return NextResponse.json({ error: "Đã xảy ra lỗi" }, { status: 500 });
  }
}
