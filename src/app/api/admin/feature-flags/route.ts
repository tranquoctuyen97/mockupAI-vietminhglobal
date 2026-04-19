import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { invalidateFlag } from "@/lib/feature-flags";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { z } from "zod";

// GET /api/admin/feature-flags — List all flags
export async function GET() {
  const currentUser = await validateSession();
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const flags = await prisma.featureFlag.findMany({
    orderBy: { key: "asc" },
  });

  return NextResponse.json({ flags });
}

// PATCH /api/admin/feature-flags — Toggle a flag
const toggleSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(request: Request) {
  const currentUser = await validateSession();
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = toggleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { key, enabled, rolloutPercent } = parsed.data;

    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      return NextResponse.json({ error: "Flag không tồn tại" }, { status: 404 });
    }

    const updated = await prisma.featureFlag.update({
      where: { key },
      data: {
        enabled,
        ...(rolloutPercent !== undefined ? { rolloutPercent } : {}),
        updatedBy: currentUser.id,
      },
    });

    // Invalidate cache
    invalidateFlag(key);

    // Audit
    const { ipAddress, userAgent } = getRequestInfo(request);
    await logAudit({
      tenantId: currentUser.tenantId,
      actorUserId: currentUser.id,
      action: "feature_flag.toggled",
      resourceType: "feature_flag",
      resourceId: key,
      metadata: {
        oldEnabled: existing.enabled,
        newEnabled: enabled,
        rolloutPercent: rolloutPercent ?? existing.rolloutPercent,
      },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ flag: updated });
  } catch (error) {
    console.error("[ADMIN/FLAGS] Toggle error:", error);
    return NextResponse.json({ error: "Đã xảy ra lỗi" }, { status: 500 });
  }
}
