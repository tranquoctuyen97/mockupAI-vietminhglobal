import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { prisma } from "@/lib/db";
import { McpCredentialError, verifyPersonalAccessToken } from "@/lib/mcp/credential-service";
import { getEffectiveMcpToolGroups } from "@/lib/mcp/permission-service";

const ConnectionTestSchema = z.union([
  z.object({ token: z.string().min(1) }),
  z.object({ credentialId: z.string().min(1) }),
]);

export async function POST(request: Request) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const parsed = ConnectionTestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a PAT or one of your credential IDs" },
      { status: 400 },
    );
  }

  try {
    if ("token" in parsed.data) {
      const auth = await verifyPersonalAccessToken(parsed.data.token);
      if (auth.userId !== session.id || auth.tenantId !== session.tenantId) {
        return NextResponse.json({ error: "Credential owner mismatch" }, { status: 403 });
      }
      return NextResponse.json({
        ok: true,
        credentialKind: auth.credentialKind,
        scopes: [...auth.scopes],
      });
    }

    const credential = await prisma.mcpCredential.findFirst({
      where: {
        id: parsed.data.credentialId,
        profile: {
          ownerUserId: session.id,
          tenantId: session.tenantId,
          status: "ENABLED",
        },
        status: "ACTIVE",
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, scopes: true },
    });
    if (!credential) {
      return NextResponse.json({ error: "Credential is not active" }, { status: 409 });
    }
    const currentGroups = await getEffectiveMcpToolGroups(session.tenantId, session.role);
    return NextResponse.json({
      ok: true,
      credentialKind: "PAT",
      scopes: credential.scopes.filter((scope) => currentGroups.has(scope as never)),
    });
  } catch (error) {
    if (error instanceof McpCredentialError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
}
