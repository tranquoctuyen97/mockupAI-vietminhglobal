import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { z } from "zod";

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await validateSession();
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Verify user exists in same tenant
    const targetUser = await prisma.user.findFirst({
      where: { id, tenantId: currentUser.tenantId },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User không tồn tại" }, { status: 404 });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);

    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
      },
    });

    // Audit
    const { ipAddress, userAgent } = getRequestInfo(request);
    await logAudit({
      tenantId: currentUser.tenantId,
      actorUserId: currentUser.id,
      action: "user.password_reset",
      resourceType: "user",
      resourceId: id,
      metadata: { targetEmail: targetUser.email },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN/USERS] Password reset error:", error);
    return NextResponse.json({ error: "Đã xảy ra lỗi" }, { status: 500 });
  }
}
