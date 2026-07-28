import { NextResponse } from "next/server";

function publicOrigin(): string {
  return new URL(
    process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
  ).origin;
}

export async function GET() {
  const origin = publicOrigin();
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [
      "store_discovery",
      "design_library",
      "mockup_library",
      "wizard",
      "publish",
    ],
  });
}
