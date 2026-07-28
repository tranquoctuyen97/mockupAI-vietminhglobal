import { NextResponse } from "next/server";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { McpCredentialError, revokeOwnCredential } from "@/lib/mcp/credential-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ credentialId: string }> },
) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const { credentialId } = await params;
  try {
    await revokeOwnCredential(session.id, credentialId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof McpCredentialError && error.code === "CREDENTIAL_NOT_FOUND") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
