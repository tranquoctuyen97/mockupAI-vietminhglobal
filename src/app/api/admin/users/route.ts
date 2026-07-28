import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { getPermissionSet } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { deriveMcpUserStatus } from "@/lib/mcp/status";

// GET /api/admin/users — List users (paginated)
export async function GET() {
  const { session: currentUser, response } = await requireFeature("users");
  if (response) return response;

  const [users, adminPermissions] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: currentUser.tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
        createdBy: true,
        mcpProfile: {
          select: {
            status: true,
            credentials: {
              select: {
                status: true,
                expiresAt: true,
                revokedAt: true,
              },
            },
            oauthGrants: {
              select: {
                expiresAt: true,
                revokedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getPermissionSet(currentUser.tenantId, "ADMIN"),
  ]);

  const hasMcpAccess = adminPermissions.has("mcp_access");
  return NextResponse.json({
    users: users.map(({ mcpProfile, ...user }) => ({
      ...user,
      mcpStatus: deriveMcpUserStatus({
        role: user.role,
        userStatus: user.status,
        hasMcpAccess,
        profile: mcpProfile,
      }),
    })),
  });
}

// POST /api/admin/users — Create user
const createUserSchema = z.object({
  email: z
    .string()
    .transform((v) => v.replace(/^["'\s]+|["'\s]+$/g, "").toLowerCase())
    .pipe(z.string().email("Email không hợp lệ")),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
  role: z.enum(["ADMIN", "OPERATOR"]),
});

export async function POST(request: Request) {
  const { session: currentUser, response } = await requireFeature("users");
  if (response) return response;

  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password, role } = parsed.data;

    // Check existing
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      return NextResponse.json({ error: "Email đã tồn tại" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        tenantId: currentUser.tenantId,
        email: email.toLowerCase(),
        passwordHash,
        role,
        status: "ACTIVE",
        mustChangePassword: true,
        createdBy: currentUser.id,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    // Audit
    const { ipAddress, userAgent } = getRequestInfo(request);
    await logAudit({
      tenantId: currentUser.tenantId,
      actorUserId: currentUser.id,
      action: "user.created",
      resourceType: "user",
      resourceId: newUser.id,
      metadata: { email: newUser.email, role: newUser.role },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error("[ADMIN/USERS] Create error:", error);
    return NextResponse.json({ error: "Đã xảy ra lỗi" }, { status: 500 });
  }
}
