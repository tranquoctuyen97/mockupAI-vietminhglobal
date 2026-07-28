import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { MCP_TOOL_GROUPS } from "@/lib/mcp/contracts";
import {
  createAuthorizationCode,
  getOAuthClient,
  OAuthProtocolError,
} from "@/lib/mcp/oauth-service";

const AuthorizationSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeChallengeMethod: z.literal("S256"),
  scopes: z.array(z.enum(MCP_TOOL_GROUPS)).min(1),
  state: z.string().max(1024).optional(),
});

export async function GET(request: Request) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const url = new URL(request.url);
  const parsed = AuthorizationSchema.safeParse({
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
    scopes: (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean),
    state: url.searchParams.get("state") ?? undefined,
  });
  if (!parsed.success || url.searchParams.get("response_type") !== "code") {
    return oauthError("invalid_request", "Invalid authorization request");
  }
  const client = await getOAuthClient(parsed.data.clientId);
  if (!client || !client.redirectUris.includes(parsed.data.redirectUri)) {
    return oauthError("invalid_request", "Invalid client or redirect URI");
  }
  const consent = new URL("/account/mcp/authorize", url.origin);
  for (const [key, value] of url.searchParams) {
    consent.searchParams.append(key, value);
  }
  consent.searchParams.set("owner", session.id);
  return NextResponse.redirect(consent);
}

export async function POST(request: Request) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const parsed = AuthorizationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return oauthError("invalid_request", "Invalid authorization request");
  }
  try {
    const result = await createAuthorizationCode({
      ownerUserId: session.id,
      clientId: parsed.data.clientId,
      redirectUri: parsed.data.redirectUri,
      codeChallenge: parsed.data.codeChallenge,
      codeChallengeMethod: parsed.data.codeChallengeMethod,
      scopes: parsed.data.scopes,
      state: parsed.data.state,
    });
    return NextResponse.json({ redirectTo: result.redirectTo });
  } catch (error) {
    if (error instanceof OAuthProtocolError) {
      return oauthError(error.error, error.errorDescription, error.status);
    }
    throw error;
  }
}

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status });
}
