/**
 * GET /api/shopify/authorize?storeId=xxx
 * Loads per-store credentials, sets CSRF state cookie, redirects to Shopify OAuth
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizationUrl, generateOAuthState } from "@/lib/shopify/oauth";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";

function getOrigin(request: Request): string {
  const headers = new Headers(request.headers);
  const forwardedHost = headers.get("x-forwarded-host") || headers.get("host");
  const forwardedProto = headers.get("x-forwarded-proto") || "http";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden - Admins only" }, { status: 403 });
  }

  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId");

  if (!storeId) {
    return NextResponse.json({ error: "storeId required" }, { status: 400 });
  }

  // Load store + credentials
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
    include: { credentials: true },
  });

  if (!store || !store.credentials) {
    return NextResponse.json({ error: "Store or credentials not found" }, { status: 404 });
  }

  const clientId = store.credentials.shopifyClientId;

  // Generate state with storeId encoded
  const state = generateOAuthState(storeId);
  const origin = getOrigin(request);
  const redirectUri = `${origin}/api/shopify/callback`;
  const isSecure = origin.startsWith("https");

  const cookieStore = await cookies();
  cookieStore.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authUrl = buildAuthorizationUrl(state, redirectUri, clientId);
  return NextResponse.redirect(authUrl);
}
