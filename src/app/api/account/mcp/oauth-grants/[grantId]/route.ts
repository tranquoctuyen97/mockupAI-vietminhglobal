import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { prisma } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ grantId: string }> },
) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const { grantId } = await params;
  const result = await prisma.mcpOAuthGrant.updateMany({
    where: {
      id: grantId,
      profile: {
        ownerUserId: session.id,
        tenantId: session.tenantId,
      },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) {
    return NextResponse.json({ error: "OAuth grant not found" }, { status: 404 });
  }

  const { ipAddress, userAgent } = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "mcp.oauth_grant.revoked",
    resourceType: "mcp_oauth_grant",
    resourceId: grantId,
    ipAddress,
    userAgent,
  });
  return NextResponse.json({ ok: true });
}
