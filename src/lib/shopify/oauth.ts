/**
 * Shopify OAuth helpers — Per-store Custom App model
 *
 * Each store has its own Custom App with unique Client ID + Secret.
 * Credentials are stored encrypted per-store in StoreCredentials.
 *
 * Flow:
 * 1. buildAuthorizationUrl(state, redirectUri, clientId, scopes)
 * 2. Shopify redirects back with ?code=...&shop=...&hmac=...
 * 3. verifyHmac(query, clientSecret) — per-store
 * 4. exchangeCodeForToken(code, shop, clientId, clientSecret)
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const DEFAULT_SCOPES = "write_products,read_products,read_orders,write_inventory";

/**
 * Build Shopify OAuth authorization URL
 * Uses per-store clientId — NOT a global env var
 */
export function buildAuthorizationUrl(
  state: string,
  redirectUri: string,
  clientId: string,
  scopes?: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes || DEFAULT_SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `https://admin.shopify.com/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 * Uses per-store clientId + clientSecret
 */
export async function exchangeCodeForToken(
  code: string,
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; scope: string }> {
  const cleanShop = sanitizeShopDomain(shop);

  const response = await fetch(`https://${cleanShop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token: string; scope: string };
  return {
    accessToken: data.access_token,
    scope: data.scope,
  };
}

/**
 * Verify HMAC signature from Shopify callback
 * Uses per-store clientSecret
 */
export function verifyHmac(query: Record<string, string>, clientSecret: string): boolean {
  const hmac = query.hmac;
  if (!hmac) return false;

  // Build message from query params (excluding hmac)
  const entries = Object.entries(query)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");

  const computed = createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify webhook HMAC — X-Shopify-Hmac-Sha256 header
 * Uses per-store clientSecret, raw body, Base64 comparison
 */
export function verifyWebhookHmac(
  rawBody: Buffer | string,
  hmacHeader: string,
  clientSecret: string,
): boolean {
  const computed = createHmac("sha256", clientSecret)
    .update(rawBody)
    .digest("base64");

  try {
    return timingSafeEqual(
      Buffer.from(hmacHeader, "base64"),
      Buffer.from(computed, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Sanitize shop domain: ensure format "xxx.myshopify.com"
 */
export function sanitizeShopDomain(shop: string): string {
  let domain = shop.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/$/, "");
  if (!domain.endsWith(".myshopify.com")) {
    domain = `${domain}.myshopify.com`;
  }
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) {
    throw new Error("Invalid Shopify domain format");
  }
  return domain;
}

/**
 * Generate random state for CSRF protection
 * Encodes storeId into state for callback lookup: {storeId}:{random}
 */
export function generateOAuthState(storeId: string): string {
  const random = randomBytes(16).toString("hex");
  return `${storeId}:${random}`;
}

/**
 * Parse storeId from OAuth state
 */
export function parseOAuthState(state: string): { storeId: string; random: string } | null {
  const idx = state.indexOf(":");
  if (idx === -1) return null;
  return {
    storeId: state.substring(0, idx),
    random: state.substring(idx + 1),
  };
}
