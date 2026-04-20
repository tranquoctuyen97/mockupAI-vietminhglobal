import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { z } from "zod";

// GET /api/admin/users — List users (paginated)
export async function GET() {
  const currentUser = await validateSession();
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { tenantId: currentUser.tenantId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      mustChangePassword: true,
      createdAt: true,
      createdBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

// POST /api/admin/users — Create user
const createUserSchema = z.object({
  email: z.string()
    .transform((v) => v.replace(/^["'\s]+|["'\s]+$/g, "").toLowerCase())
    .pipe(z.string().email("Email không hợp lệ")),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
  role: z.enum(["ADMIN", "OPERATOR"]),
});

export async function POST(request: Request) {
  const currentUser = await validateSession();
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

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
