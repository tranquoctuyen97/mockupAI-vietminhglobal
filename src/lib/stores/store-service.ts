/**
 * Store Service — Business logic for store CRUD + token management
 */

import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import { ShopifyClient } from "@/lib/shopify/client";
import type { Prisma } from "@prisma/client";

/**
 * Save Shopify credentials after OAuth callback
 */
export async function saveShopifyConnection(input: {
  tenantId: string;
  name: string;
  shopifyDomain: string;
  shopifyAccessToken: string;
  shopifyClientId: string;
  shopifyClientSecret: string;
  shopifyShopId?: string;
  createdBy?: string;
}) {
  const { encrypted: tokenEncrypted, keyId } = encrypt(input.shopifyAccessToken);
  const { encrypted: secretEnc } = encrypt(input.shopifyClientSecret);

  const store = await prisma.store.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      shopifyDomain: input.shopifyDomain,
      shopifyShopId: input.shopifyShopId ?? null,
      status: "ACTIVE",
      createdBy: input.createdBy ?? null,
      credentials: {
        create: {
          shopifyClientId: input.shopifyClientId,
          shopifyClientSecretEnc: secretEnc,
          shopifyTokenEncrypted: tokenEncrypted,
          encryptionKeyId: keyId,
        },
      },
    },
    include: { credentials: true },
  });

  return store;
}

/**
 * Get decrypted Shopify tokens for a store
 */
export async function getDecryptedTokens(storeId: string) {
  const creds = await prisma.storeCredentials.findUnique({
    where: { storeId },
  });

  if (!creds) {
    throw new Error(`No credentials found for store ${storeId}`);
  }

  const shopifyToken = creds.shopifyTokenEncrypted
    ? decrypt(creds.shopifyTokenEncrypted)
    : null;

  return { shopifyToken };
}

/**
 * Test connection for a store (Shopify + Printify if linked)
 */
export async function testStoreConnection(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: {
      printifyShop: {
        include: {
          account: { select: { apiKeyEncrypted: true, status: true } },
        },
      },
    },
  });

  const tokens = await getDecryptedTokens(storeId);

  if (!tokens.shopifyToken) {
    return { shopify: { ok: false, error: "Shopify not connected (no access token)" }, printify: { ok: true } };
  }

  // Test Shopify
  const shopifyClient = new ShopifyClient(store.shopifyDomain, tokens.shopifyToken);
  const shopifyResult = await shopifyClient.testConnection();

  // Test Printify (via workspace-level account if linked)
  let printifyResult: { ok: boolean; error?: string } = { ok: true };
  if (store.printifyShop && store.printifyShop.account.status === "ACTIVE") {
    try {
      const { PrintifyClient } = await import("@/lib/printify/client");
      const apiKey = decrypt(store.printifyShop.account.apiKeyEncrypted);
      const client = new PrintifyClient(apiKey);
      printifyResult = await client.testConnection();
    } catch (e) {
      printifyResult = { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
    }
  }

  // Update store status
  let newStatus: "ACTIVE" | "TOKEN_EXPIRED" | "ERROR" = "ACTIVE";
  if (!shopifyResult.ok || !printifyResult.ok) {
    const errors = [shopifyResult.error, printifyResult.error].filter(Boolean);
    const isAuthError = errors.some(
      (e) => e?.includes("expired") || e?.includes("invalid"),
    );
    newStatus = isAuthError ? "TOKEN_EXPIRED" : "ERROR";
  }

  await prisma.store.update({
    where: { id: storeId },
    data: {
      status: newStatus,
      lastHealthCheck: new Date(),
    },
  });

  return {
    shopify: shopifyResult,
    printify: printifyResult,
    status: newStatus,
  };
}

/**
 * List stores for a tenant
 */
export async function listStores(tenantId: string) {
  return prisma.store.findMany({
    where: { tenantId, deletedAt: null },
    include: {
      colors: { orderBy: { sortOrder: "asc" } },
      templates: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Soft delete a store
 */
export async function softDeleteStore(storeId: string) {
  // TODO Phase 5: Check if store has active listings before deleting
  return prisma.store.update({
    where: { id: storeId },
    data: { deletedAt: new Date() },
  });
}

/**
 * Upsert colors for a store (batch)
 */
export async function upsertStoreColors(
  storeId: string,
  colors: Array<{ name: string; hex: string; printifyColorId?: string; sortOrder?: number }>,
) {
  // Delete existing colors and recreate (simpler than individual upserts)
  await prisma.$transaction([
    prisma.storeColor.deleteMany({ where: { storeId } }),
    ...colors.map((color, i) =>
      prisma.storeColor.create({
        data: {
          storeId,
          name: color.name,
          hex: color.hex,
          printifyColorId: color.printifyColorId ?? null,
          sortOrder: color.sortOrder ?? i,
        },
      }),
    ),
  ] as Prisma.PrismaPromise<unknown>[]);

  return prisma.storeColor.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Save mockup templates for a store
 */
export async function saveStoreTemplates(
  storeId: string,
  templates: Array<{
    name: string;
    printifyBlueprintId: number;
    printifyPrintProviderId: number;
    previewUrl?: string;
    position?: "FRONT" | "BACK" | "SLEEVE";
    isDefault?: boolean;
  }>,
) {
  // Delete existing and recreate
  await prisma.$transaction([
    prisma.storeMockupTemplate.deleteMany({ where: { storeId } }),
    ...templates.map((t) =>
      prisma.storeMockupTemplate.create({
        data: {
          storeId,
          name: t.name,
          printifyBlueprintId: t.printifyBlueprintId,
          printifyPrintProviderId: t.printifyPrintProviderId,
          previewUrl: t.previewUrl ?? null,
          position: t.position ?? "FRONT",
          isDefault: t.isDefault ?? false,
        },
      }),
    ),
  ] as Prisma.PrismaPromise<unknown>[]);

  return prisma.storeMockupTemplate.findMany({
    where: { storeId },
  });
}
