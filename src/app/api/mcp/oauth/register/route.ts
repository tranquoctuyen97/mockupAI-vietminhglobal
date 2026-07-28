import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestInfo } from "@/lib/audit";
import { OAuthProtocolError, registerPublicOAuthClient } from "@/lib/mcp/oauth-service";
import { consumeMcpRateLimit, McpRateLimitError } from "@/lib/mcp/rate-limit";

const RegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  grant_types: z
    .array(z.string())
    .max(2)
    .optional()
    .refine(
      (value) =>
        !value || value.every((item) => ["authorization_code", "refresh_token"].includes(item)),
      "Unsupported grant type",
    ),
  response_types: z
    .array(z.string())
    .max(1)
    .optional()
    .refine(
      (value) => !value || value.every((item) => item === "code"),
      "Unsupported response type",
    ),
  token_endpoint_auth_method: z.literal("none").optional(),
});

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "OAuth client metadata is too large",
      },
      { status: 413 },
    );
  }
  const { ipAddress } = getRequestInfo(request);
  try {
    await consumeMcpRateLimit(`oauth-registration:${ipAddress ?? "unknown"}`, "url_import");
  } catch (error) {
    if (error instanceof McpRateLimitError) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "Too many dynamic client registrations",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(error.retryAfterSeconds),
          },
        },
      );
    }
    throw error;
  }
  const parsed = RegistrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Invalid OAuth client metadata",
      },
      { status: 400 },
    );
  }
  try {
    const client = await registerPublicOAuthClient({
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
    });
    return NextResponse.json(
      {
        client_id: client.clientId,
        client_name: parsed.data.client_name,
        redirect_uris: parsed.data.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201 },
    );
  } catch (error) {
    return mapOAuthError(error);
  }
}

function mapOAuthError(error: unknown) {
  if (error instanceof OAuthProtocolError) {
    return NextResponse.json(
      {
        error: error.error,
        error_description: error.errorDescription,
      },
      { status: error.status },
    );
  }
  throw error;
}
