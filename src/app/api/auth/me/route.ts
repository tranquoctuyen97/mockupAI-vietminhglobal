import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await validateSession();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    status: user.status,
  });
}
