import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { prisma } from "@/lib/db";
import { MCP_TOOL_GROUPS } from "@/lib/mcp/contracts";
import { createPersonalAccessToken, McpCredentialError } from "@/lib/mcp/credential-service";

const CreateCredentialSchema = z.object({
  label: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(MCP_TOOL_GROUPS)).min(1).optional(),
  expiresInDays: z.number().int().min(1).max(365),
});

export async function GET() {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const credentials = await prisma.mcpCredential.findMany({
    where: { profile: { ownerUserId: session.id } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      tokenPrefix: true,
      scopes: true,
      expiresAt: true,
      status: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  return NextResponse.json({ credentials });
}

export async function POST(request: Request) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const parsed = CreateCredentialSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid credential input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const created = await createPersonalAccessToken({
      userId: session.id,
      label: parsed.data.label,
      scopes: parsed.data.scopes ?? [],
      expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof McpCredentialError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "SCOPE_NOT_ALLOWED" ? 400 : 403 },
      );
    }
    throw error;
  }
}
