import { NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  OAuthProtocolError,
  refreshOAuthGrant,
} from "@/lib/mcp/oauth-service";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError(
      new OAuthProtocolError("invalid_request", "Token endpoint requires form-urlencoded input"),
    );
  }
  const form = await request.formData();
  const grantType = String(form.get("grant_type") ?? "");
  try {
    if (grantType === "authorization_code") {
      const response = await exchangeAuthorizationCode({
        clientId: String(form.get("client_id") ?? ""),
        code: String(form.get("code") ?? ""),
        redirectUri: String(form.get("redirect_uri") ?? ""),
        codeVerifier: String(form.get("code_verifier") ?? ""),
      });
      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (grantType === "refresh_token") {
      const response = await refreshOAuthGrant({
        clientId: String(form.get("client_id") ?? ""),
        refreshToken: String(form.get("refresh_token") ?? ""),
      });
      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw new OAuthProtocolError("unsupported_grant_type", "Unsupported OAuth grant type");
  } catch (error) {
    if (error instanceof OAuthProtocolError) return oauthError(error);
    throw error;
  }
}

function oauthError(error: OAuthProtocolError) {
  return NextResponse.json(
    {
      error: error.error,
      error_description: error.errorDescription,
    },
    {
      status: error.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
