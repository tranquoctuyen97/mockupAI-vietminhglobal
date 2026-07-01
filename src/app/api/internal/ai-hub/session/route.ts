import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ensureAiHubWorkspaces } from "@/lib/ai-hub/workspaces";
import { hasValidAiHubInternalAuth } from "@/lib/ai-hub/internal-auth";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = (await headers()).get("authorization") ?? "";
  if (!hasValidAiHubInternalAuth(auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensureAiHubWorkspaces({ id: session.id, tenantId: session.tenantId });
  return NextResponse.json({ memberId: session.id, tenantId: session.tenantId });
}
