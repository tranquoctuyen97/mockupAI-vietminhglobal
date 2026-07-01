import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";

export async function requireAiHubAdmin() {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN") {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const ok = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!ok) {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, response: null };
}
