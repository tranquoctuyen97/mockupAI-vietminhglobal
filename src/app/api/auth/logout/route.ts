import { NextResponse } from "next/server";
import { validateSession, clearSessionCookie, getCurrentTokenHash } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { logAudit, getRequestInfo } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const user = await validateSession();
    if (!user) {
      await clearSessionCookie();
      return NextResponse.json({ success: true });
    }

    // Delete session from DB
    const tokenHash = await getCurrentTokenHash();
    if (tokenHash) {
      await prisma.session.deleteMany({ where: { tokenHash } });
    }

    // Clear cookie
    await clearSessionCookie();

    // Audit log
    const { ipAddress, userAgent } = getRequestInfo(request);
    await logAudit({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: "user.logout",
      resourceType: "user",
      resourceId: user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[LOGOUT] Error:", error);
    await clearSessionCookie();
    return NextResponse.json({ success: true });
  }
}
