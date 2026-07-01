import { NextResponse } from "next/server";
import { hasValidAiHubInternalAuth } from "@/lib/ai-hub/internal-auth";
import { AI_HUB_PROVIDER_CODEX, listAiHubWorkspacesForMember } from "@/lib/ai-hub/workspaces";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!hasValidAiHubInternalAuth(auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? AI_HUB_PROVIDER_CODEX;
  if (provider !== AI_HUB_PROVIDER_CODEX) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const userId = request.headers.get("x-internal-member-id");
  if (!userId) {
    return NextResponse.json({ error: "Missing member id" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const workspaces = await listAiHubWorkspacesForMember(user.tenantId, user.id, provider);
  return NextResponse.json(workspaces);
}
