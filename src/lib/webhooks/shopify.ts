/**
 * Shopify Webhook HMAC verification + event logging
 * Per-store: looks up store by domain → decrypts clientSecret → verifies HMAC
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";
import { verifyWebhookHmac } from "@/lib/shopify/oauth";

interface WebhookVerifyResult {
  valid: boolean;
  storeId?: string;
  tenantId?: string;
  topic?: string;
  shopDomain?: string;
}

/**
 * Verify incoming Shopify webhook and log event
 */
export async function verifyAndLogWebhook(
  rawBody: Buffer,
  headers: Headers,
): Promise<WebhookVerifyResult> {
  const hmacHeader = headers.get("x-shopify-hmac-sha256") || "";
  const topic = headers.get("x-shopify-topic") || "";
  const shopDomain = headers.get("x-shopify-shop-domain") || "";

  if (!hmacHeader || !topic || !shopDomain) {
    return { valid: false };
  }

  // Parse payload for external ID
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    // Log anyway
  }

  const externalId = String(payload.id || "unknown");

  // Lookup store by domain
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain },
    include: { credentials: true },
  });

  if (!store || !store.credentials) {
    // Log invalid event
    await prisma.webhookEvent.create({
      data: {
        source: "shopify",
        topic,
        externalId,
        signatureValid: false,
        payload: payload as object,
        error: `Store not found: ${shopDomain}`,
      },
    });
    return { valid: false };
  }

  // Decrypt per-store client secret
  const clientSecret = decrypt(store.credentials.shopifyClientSecretEnc);

  // Verify HMAC
  const valid = verifyWebhookHmac(rawBody, hmacHeader, clientSecret);

  // Log event
  await prisma.webhookEvent.create({
    data: {
      source: "shopify",
      topic,
      externalId,
      signatureValid: valid,
      payload: payload as object,
      processedAt: valid ? new Date() : null,
      error: valid ? null : "HMAC verification failed",
    },
  });

  if (!valid) {
    return { valid: false };
  }

  return {
    valid: true,
    storeId: store.id,
    tenantId: store.tenantId,
    topic,
    shopDomain,
  };
}
