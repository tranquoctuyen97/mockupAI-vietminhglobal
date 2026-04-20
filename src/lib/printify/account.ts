/**
 * Printify Account Service — workspace-level Printify account management
 * Phase 6.5: One account per tenant, shared across all stores
 */

import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import { PrintifyClient } from "./client";

/**
 * Create a new Printify account — test connection first, then save encrypted key
 */
export async function createPrintifyAccount(input: {
  tenantId: string;
  nickname: string;
  apiKey: string;
  createdBy?: string;
}) {
  // Test connection first
  const client = new PrintifyClient(input.apiKey);
  const test = await client.testConnection();
  if (!test.ok) {
    throw new Error(`Printify connection failed: ${test.error}`);
  }

  const { encrypted, keyId } = encrypt(input.apiKey);

  const account = await prisma.printifyAccount.create({
    data: {
      tenantId: input.tenantId,
      nickname: input.nickname,
      apiKeyEncrypted: encrypted,
      encryptionKeyId: keyId,
      createdBy: input.createdBy ?? null,
    },
  });

  // Auto-sync shops after creation
  const shops = await syncPrintifyShops(account.id);

  return { account, shops };
}

/**
 * List all Printify accounts for a tenant (key masked)
 */
export async function listPrintifyAccounts(tenantId: string) {
  const accounts = await prisma.printifyAccount.findMany({
    where: { tenantId },
    include: {
      shops: {
        include: {
          stores: { select: { id: true, name: true, shopifyDomain: true } },
        },
        orderBy: { title: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return accounts.map((a) => ({
    ...a,
    apiKeyMasked: maskApiKey(a.apiKeyEncrypted),
    apiKeyEncrypted: undefined, // never expose raw encrypted bytes
  }));
}

/**
 * Rotate API key for an existing account
 */
export async function rotatePrintifyKey(accountId: string, newApiKey: string) {
  // Test new key first
  const client = new PrintifyClient(newApiKey);
  const test = await client.testConnection();
  if (!test.ok) {
    throw new Error(`New API key validation failed: ${test.error}`);
  }

  const { encrypted, keyId } = encrypt(newApiKey);

  await prisma.printifyAccount.update({
    where: { id: accountId },
    data: {
      apiKeyEncrypted: encrypted,
      encryptionKeyId: keyId,
      status: "ACTIVE",
      rotatedAt: new Date(),
    },
  });

  // Re-sync shops with new key
  await syncPrintifyShops(accountId);
}

/**
 * Delete a Printify account — block if any shop is linked to a store
 */
export async function deletePrintifyAccount(accountId: string) {
  const account = await prisma.printifyAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: {
      shops: {
        include: {
          stores: { select: { id: true, name: true, shopifyDomain: true } },
        },
      },
    },
  });

  // Check if any shop is linked to a store
  const linkedStores = account.shops.flatMap((s) => s.stores);
  if (linkedStores.length > 0) {
    throw new LinkedStoresError(
      `Cannot delete: ${linkedStores.length} store(s) still linked`,
      linkedStores,
    );
  }

  await prisma.printifyAccount.delete({ where: { id: accountId } });
}

/**
 * Get decrypted API key for an account
 */
export function decryptAccountKey(apiKeyEncrypted: Buffer | Uint8Array): string {
  return decrypt(apiKeyEncrypted);
}

/**
 * Sync shops from Printify API for an account
 */
export async function syncPrintifyShops(accountId: string) {
  const account = await prisma.printifyAccount.findUniqueOrThrow({
    where: { id: accountId },
  });

  const apiKey = decrypt(account.apiKeyEncrypted);
  const client = new PrintifyClient(apiKey);
  const remoteShops = await client.getShops();

  const remoteIds = new Set(remoteShops.map((s) => s.id));

  // Upsert remote shops
  for (const shop of remoteShops) {
    await prisma.printifyShop.upsert({
      where: {
        printifyAccountId_externalShopId: {
          printifyAccountId: accountId,
          externalShopId: shop.id,
        },
      },
      update: {
        title: shop.title,
        salesChannel: shop.sales_channel ?? null,
        disconnected: false,
        syncedAt: new Date(),
      },
      create: {
        printifyAccountId: accountId,
        externalShopId: shop.id,
        title: shop.title,
        salesChannel: shop.sales_channel ?? null,
        disconnected: false,
      },
    });
  }

  // Mark shops that no longer exist on Printify
  const existingShops = await prisma.printifyShop.findMany({
    where: { printifyAccountId: accountId },
  });
  for (const shop of existingShops) {
    if (!remoteIds.has(shop.externalShopId)) {
      await prisma.printifyShop.update({
        where: { id: shop.id },
        data: { disconnected: true },
      });
    }
  }

  // Update account sync timestamp
  await prisma.printifyAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: new Date() },
  });

  return prisma.printifyShop.findMany({
    where: { printifyAccountId: accountId },
    include: {
      stores: { select: { id: true, name: true, shopifyDomain: true } },
    },
    orderBy: { title: "asc" },
  });
}

/**
 * Get available shops (not disconnected, not claimed by another store)
 */
export async function getAvailableShops(tenantId: string) {
  // Get all accounts for the tenant
  const accounts = await prisma.printifyAccount.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { id: true },
  });

  const accountIds = accounts.map((a) => a.id);
  if (accountIds.length === 0) return [];

  return prisma.printifyShop.findMany({
    where: {
      printifyAccountId: { in: accountIds },
      disconnected: false,
      stores: { none: {} }, // not linked to any store
    },
    include: {
      account: { select: { id: true, nickname: true } },
    },
    orderBy: { title: "asc" },
  });
}

/**
 * Link a Printify shop to a Shopify store
 */
export async function linkPrintifyShop(storeId: string, printifyShopId: string, tenantId: string) {
  // Verify shop belongs to an account in this tenant
  const shop = await prisma.printifyShop.findUnique({
    where: { id: printifyShopId },
    include: { account: { select: { tenantId: true } } },
  });

  if (!shop || shop.account.tenantId !== tenantId) {
    throw new Error("Printify shop not found or does not belong to this tenant");
  }

  if (shop.disconnected) {
    throw new Error("Cannot link a disconnected shop. Please resync first.");
  }

  // Check if shop is already claimed by another store (unique constraint handles this too)
  const existingLink = await prisma.store.findFirst({
    where: { printifyShopId, id: { not: storeId } },
  });
  if (existingLink) {
    throw new Error(`Shop already linked to store "${existingLink.name}"`);
  }

  await prisma.store.update({
    where: { id: storeId },
    data: { printifyShopId },
  });
}

/**
 * Unlink Printify shop from a store
 */
export async function unlinkPrintifyShop(storeId: string) {
  await prisma.store.update({
    where: { id: storeId },
    data: { printifyShopId: null },
  });
}

/**
 * Get a PrintifyClient for a given store (used by publish/mockup workers)
 */
export async function getClientForStore(storeId: string): Promise<{ client: PrintifyClient; externalShopId: number }> {
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

  if (!store.printifyShop) {
    throw new Error("Store has no Printify shop linked. Please configure in Store Settings.");
  }

  if (store.printifyShop.disconnected) {
    throw new Error("Linked Printify shop has been disconnected. Please resync or choose another shop.");
  }

  if (store.printifyShop.account.status !== "ACTIVE") {
    throw new Error("Printify account is inactive. Please check API key.");
  }

  const apiKey = decrypt(store.printifyShop.account.apiKeyEncrypted);
  const client = new PrintifyClient(apiKey);

  return { client, externalShopId: store.printifyShop.externalShopId };
}

// ----- Helpers -----

function maskApiKey(encrypted: Buffer | Uint8Array): string {
  try {
    const raw = decrypt(encrypted);
    return `••••••${raw.slice(-4)}`;
  } catch {
    return "••••••????";
  }
}

export class LinkedStoresError extends Error {
  stores: Array<{ id: string; name: string; shopifyDomain: string }>;
  constructor(
    message: string,
    stores: Array<{ id: string; name: string; shopifyDomain: string }>,
  ) {
    super(message);
    this.name = "LinkedStoresError";
    this.stores = stores;
  }
}
