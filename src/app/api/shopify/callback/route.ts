/**
 * GET /api/shopify/callback
 * Per-store OAuth callback — decodes storeId from state, uses per-store credentials
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCodeForToken,
  verifyHmac,
  sanitizeShopDomain,
  parseOAuthState,
} from "@/lib/shopify/oauth";
import { ShopifyClient } from "@/lib/shopify/client";
import { requireFeature } from "@/lib/auth/guards";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/envelope";

function getBaseUrl(request: Request): string {
  const headers = new Headers(request.headers);
  const forwardedHost = headers.get("x-forwarded-host") || headers.get("host");
  const forwardedProto = headers.get("x-forwarded-proto") || "http";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = getBaseUrl(request);
  const code = url.searchParams.get("code");
  const shop = url.searchParams.get("shop");
  const state = url.searchParams.get("state");

  if (!code || !shop || !state) {
    return NextResponse.redirect(new URL("/stores/new?error=missing_params", baseUrl));
  }

  const { session, response } = await requireFeature("stores");
  if (response) return response;

  // Verify state (CSRF protection)
  const cookieStore = await cookies();
  const savedState = cookieStore.get("shopify_oauth_state")?.value;

  if (!savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/stores/new?error=invalid_state", baseUrl));
  }

  // Parse storeId from state
  const parsed = parseOAuthState(state);
  if (!parsed) {
    return NextResponse.redirect(new URL("/stores/new?error=invalid_state", baseUrl));
  }

  const { storeId } = parsed;

  // Load store credentials
  const creds = await prisma.storeCredentials.findUnique({
    where: { storeId },
  });

  if (!creds) {
    return NextResponse.redirect(new URL("/stores/new?error=credentials_not_found", baseUrl));
  }

  const clientId = creds.shopifyClientId;
  const clientSecret = decrypt(creds.shopifyClientSecretEnc);

  // Verify HMAC with per-store secret
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });
  if (!verifyHmac(queryParams, clientSecret)) {
    return NextResponse.redirect(new URL("/stores/new?error=invalid_hmac", baseUrl));
  }

  const cleanShop = sanitizeShopDomain(shop);

  try {
    // Exchange code for access token using per-store credentials
    const { accessToken, scope } = await exchangeCodeForToken(code, cleanShop, clientId, clientSecret);

    // Get shop info
    const shopifyClient = new ShopifyClient(cleanShop, accessToken);
    const shopInfo = await shopifyClient.getShop();

    // Update store with Shopify info + encrypted access token
    const { encrypted: tokenEncrypted } = encrypt(accessToken);

    await prisma.store.update({
      where: { id: storeId },
      data: {
        shopifyDomain: cleanShop,
        shopifyShopId: shopInfo.id,
        name: shopInfo.name || undefined,
        status: "ACTIVE",
      },
    });

    await prisma.storeCredentials.update({
      where: { storeId },
      data: {
        shopifyTokenEncrypted: tokenEncrypted,
        rotatedAt: new Date(),
      },
    });

    // Audit log
    if (session) {
      const reqInfo = getRequestInfo(request);
      await logAudit({
        tenantId: session.tenantId,
        actorUserId: session.id,
        action: "store.shopify_connected",
        resourceType: "store",
        resourceId: storeId,
        metadata: { shopifyDomain: cleanShop, shopName: shopInfo.name, scope },
        ...reqInfo,
      });
    }

    // Clear OAuth cookies
    cookieStore.delete("shopify_oauth_state");

    return NextResponse.redirect(
      new URL(`/stores/${storeId}/config?step=printify&connected=shopify`, baseUrl),
    );
  } catch (error) {
    console.error("Shopify OAuth callback error:", error);
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.redirect(
      new URL(`/stores/new?error=oauth_failed&message=${encodeURIComponent(errorMsg)}`, baseUrl),
    );
  }
}
