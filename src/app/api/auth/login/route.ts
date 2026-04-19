import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { logAudit, getRequestInfo } from "@/lib/audit";
import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
} from "@/lib/auth/rate-limit";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
    const { ipAddress, userAgent } = getRequestInfo(request);
    const ip = ipAddress || "unknown";

    // Rate limit check
    const rateLimit = checkRateLimit(email, ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Quá nhiều lần đăng nhập thất bại. Thử lại sau ${rateLimit.retryAfterSeconds} giây.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        tenantId: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        mustChangePassword: true,
      },
    });

    if (!user) {
      recordFailedAttempt(email, ip);
      return NextResponse.json(
        { error: "Email hoặc mật khẩu không đúng" },
        { status: 401 },
      );
    }

    // Check user status
    if (user.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Tài khoản đã bị vô hiệu hóa. Liên hệ Admin." },
        { status: 403 },
      );
    }

    // Verify password
    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      recordFailedAttempt(email, ip);
      return NextResponse.json(
        { error: "Email hoặc mật khẩu không đúng" },
        { status: 401 },
      );
    }

    // Clear rate limit on success
    clearRateLimit(email, ip);

    // Create session
    await createSession(user.id, request);

    // Audit log
    await logAudit({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: "user.login",
      resourceType: "user",
      resourceId: user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (error) {
    console.error("[LOGIN] Error:", error);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi. Vui lòng thử lại." },
      { status: 500 },
    );
  }
}
