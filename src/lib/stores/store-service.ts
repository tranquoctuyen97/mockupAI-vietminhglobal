/**
 * Store Service — Business logic for store CRUD + token management
 */

import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import { PrintifyClient } from "@/lib/printify/client";
import { ShopifyClient } from "@/lib/shopify/client";
import { getPresetStatusSync } from "@/lib/stores/preset";
import { enrichColorHex } from "@/lib/printify/color-hex";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import {
  normalizeMoneyValue,
  normalizePriceBySizeDefault,
} from "@/lib/pricing/template-pricing";
import {
  getTemplateReadiness,
  type TemplateReadinessInput,
  type TemplateMissing,
} from "@/lib/stores/template-readiness";
import { normalizeTags } from "@/lib/wizard/product-organization";
import { Prisma } from "@prisma/client";

export class TemplateNotReadyError extends Error {
  missing: TemplateMissing[];

  constructor(missing: TemplateMissing[]) {
    super("Template is incomplete and cannot be set as default");
    this.name = "TemplateNotReadyError";
    this.missing = missing;
  }
}

export function assertTemplateReadyForDefault(
  template: TemplateReadinessInput,
): void {
  const readiness = getTemplateReadiness(template);
  if (!readiness.ready) {
    throw new TemplateNotReadyError(readiness.missing);
  }
}

export function shouldCreateTemplateAsDefault(
  existingCount: number,
  template: TemplateReadinessInput,
): boolean {
  return existingCount === 0 && getTemplateReadiness(template).ready;
}

export function pickNextReadyDefaultTemplate<T extends TemplateReadinessInput>(
  templates: T[],
): T | undefined {
  return templates.find((candidate) => getTemplateReadiness(candidate).ready);
}

type TemplateDefaultTagsClient = {
  $queryRaw: typeof prisma.$queryRaw;
  $executeRaw: typeof prisma.$executeRaw;
};

export async function loadTemplateDefaultTags(
  templateIds: string[],
  client: Pick<TemplateDefaultTagsClient, "$queryRaw"> = prisma,
): Promise<Map<string, string[]>> {
  if (templateIds.length === 0) return new Map();

  const rows = await client.$queryRaw<Array<{ id: string; default_tags: string[] | null }>>(
    Prisma.sql`
      SELECT id, default_tags
      FROM "store_mockup_templates"
      WHERE id IN (${Prisma.join(templateIds)})
    `,
  );

  return new Map(
    rows.map((row) => [row.id, normalizeTags(row.default_tags ?? [])]),
  );
}

async function updateTemplateDefaultTags(
  templateId: string,
  defaultTags: unknown,
  client: Pick<TemplateDefaultTagsClient, "$executeRaw">,
): Promise<void> {
  await client.$executeRaw`
    UPDATE "store_mockup_templates"
    SET "default_tags" = ${normalizeTags(defaultTags)}
    WHERE "id" = ${templateId}
  `;
}

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
  const stores = await prisma.store.findMany({
    relationLoadStrategy: "join", // PostgreSQL LATERAL JOIN — 1 query instead of 5
    where: { tenantId },
    include: {
      colors: { orderBy: { sortOrder: "asc" } },
      templates: {
        orderBy: { sortOrder: "asc" },
        include: {
          colors: {
            orderBy: { sortOrder: "asc" },
            include: { color: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Enrich template color hex from PrintifyVariantCache
  const bpPairs = new Set<string>();
  for (const store of stores) {
    for (const t of store.templates) {
      bpPairs.add(`${t.printifyBlueprintId}:${t.printifyPrintProviderId}`);
    }
  }
  // Enrich template color hex from PrintifyVariantCache
  // Batch all pairs into a single query instead of N sequential queries
  const cacheHexMap = new Map<string, string>();
  if (bpPairs.size > 0) {
    const allCached = await prisma.printifyVariantCache.findMany({
      where: {
        OR: [...bpPairs].map((pair) => {
          const [bpId, ppId] = pair.split(":").map(Number);
          return { blueprintId: bpId, printProviderId: ppId };
        }),
      },
      select: { colorName: true, colorHex: true },
    });
    for (const c of allCached) {
      if (c.colorHex && !cacheHexMap.has(c.colorName)) {
        cacheHexMap.set(c.colorName, c.colorHex);
      }
    }
  }

  // Compute presetStatus for each store + serialize Decimal fields
  return stores.map((store) => {
    // Enrich template color hex in-place before returning
    const enrichedTemplates = store.templates.map((t) => ({
      ...t,
      colors: t.colors.map((tc) => ({
        ...tc,
        color: {
          ...tc.color,
          hex: cacheHexMap.get(tc.color.name) || enrichColorHex(tc.color.name, tc.color.hex),
        },
      })),
    }));

    return {
      ...store,
      templates: enrichedTemplates,
      defaultPriceUsd: Number(store.defaultPriceUsd), // Decimal → number for Client Components
      presetStatus: getPresetStatusSync(store),
    };
  });
}

/**
 * Hard delete a store and all related data (credentials cascade via schema)
 */
export async function deleteStore(storeId: string) {
  // Unlink Printify shop before deleting (set FK to null)
  await prisma.store.update({
    where: { id: storeId },
    data: { printifyShopId: null },
  });

  return prisma.store.delete({
    where: { id: storeId },
  });
}

/**
 * Upsert colors for a store (batch)
 */
export async function upsertStoreColors(
  storeId: string,
  colors: Array<{ name: string; hex: string; printifyColorId?: string; sortOrder?: number }>,
) {
  const incomingNames = new Set(colors.map((c) => c.name));

  await prisma.$transaction(async (tx) => {
    // 1. Delete colors that are not in the incoming batch
    await tx.storeColor.deleteMany({
      where: {
        storeId,
        name: { notIn: Array.from(incomingNames) },
      },
    });

    // 2. Upsert incoming colors
    for (const [i, color] of colors.entries()) {
      await tx.storeColor.upsert({
        where: {
          storeId_name: {
            storeId,
            name: color.name,
          },
        },
        create: {
          storeId,
          name: color.name,
          hex: color.hex,
          printifyColorId: color.printifyColorId ?? null,
          sortOrder: color.sortOrder ?? i,
        },
        update: {
          hex: color.hex,
          printifyColorId: color.printifyColorId ?? null,
          sortOrder: color.sortOrder ?? i,
        },
      });
    }
  });

  return prisma.storeColor.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Create a new template for a store
 */
export async function createTemplate(
  storeId: string,
  data: {
    name: string;
    printifyBlueprintId: number;
    printifyPrintProviderId: number;
    blueprintTitle?: string;
    printProviderTitle?: string;
    previewUrl?: string;
    position?: "FRONT" | "BACK" | "SLEEVE";
    enabledVariantIds?: number[];
    enabledSizes?: string[];
    defaultPlacement?: Prisma.InputJsonValue;
    defaultAspectRatio?: string;
    storePresetSnapshot?: Prisma.InputJsonValue;
    printAreasByView?: Prisma.InputJsonValue;
    blueprintImageUrl?: string;
    blueprintBrand?: string;
    colorIds?: string[];
    defaultMockupSource?: "PRINTIFY" | "CUSTOM";
    basePriceUsd?: number | string | null;
    priceBySizeDefault?: Record<string, unknown> | null;
    defaultTags?: unknown;
  },
) {
  const existingCount = await prisma.storeMockupTemplate.count({ where: { storeId } });
  const draftTemplateForReadiness = {
    printifyBlueprintId: data.printifyBlueprintId,
    printifyPrintProviderId: data.printifyPrintProviderId,
    enabledVariantIds: data.enabledVariantIds ?? [],
    defaultPlacement: data.defaultPlacement,
    colors: data.colorIds ?? [],
  };
  const isDefault = shouldCreateTemplateAsDefault(existingCount, draftTemplateForReadiness);

  return prisma.$transaction(async (tx) => {
    const template = await tx.storeMockupTemplate.create({
      data: {
        storeId,
        name: data.name,
        printifyBlueprintId: data.printifyBlueprintId,
        printifyPrintProviderId: data.printifyPrintProviderId,
        blueprintTitle: data.blueprintTitle ?? "",
        printProviderTitle: data.printProviderTitle ?? "",
        previewUrl: data.previewUrl ?? null,
        position: data.position ?? "FRONT",
        isDefault,
        enabledVariantIds: data.enabledVariantIds ?? [],
        enabledSizes: data.enabledSizes ?? [],
        defaultPlacement: data.defaultPlacement ?? undefined,
        defaultAspectRatio: data.defaultAspectRatio ?? "1:1",
        storePresetSnapshot: data.storePresetSnapshot ?? undefined,
        printAreasByView: data.printAreasByView ?? undefined,
        blueprintImageUrl: data.blueprintImageUrl ?? null,
        blueprintBrand: data.blueprintBrand ?? null,
        sortOrder: existingCount,
        defaultMockupSource: data.defaultMockupSource ?? "PRINTIFY",
        basePriceUsd: normalizeMoneyValue(data.basePriceUsd) ?? null,
        priceBySizeDefault:
          normalizePriceBySizeDefault(data.priceBySizeDefault) ?? undefined,


      },
    });

    await updateTemplateDefaultTags(template.id, data.defaultTags, tx);

    if (data.colorIds && data.colorIds.length > 0) {
      await tx.templateColor.createMany({
        data: data.colorIds.map((colorId, i) => ({
          templateId: template.id,
          colorId,
          sortOrder: i,
        })),
      });
    }

    return template;
  });
}

/**
 * Update an existing template by ID
 */
export async function updateTemplate(
  templateId: string,
  data: {
    name?: string;
    printifyBlueprintId?: number;
    printifyPrintProviderId?: number;
    blueprintTitle?: string;
    printProviderTitle?: string;
    previewUrl?: string;
    position?: "FRONT" | "BACK" | "SLEEVE";
    enabledVariantIds?: number[];
    enabledSizes?: string[];
    defaultPlacement?: Prisma.InputJsonValue;
    defaultAspectRatio?: string;
    storePresetSnapshot?: Prisma.InputJsonValue;
    printAreasByView?: Prisma.InputJsonValue;
    blueprintImageUrl?: string;
    blueprintBrand?: string;
    defaultMockupSource?: "PRINTIFY" | "CUSTOM";
    colorIds?: string[];
    basePriceUsd?: number | string | null;
    priceBySizeDefault?: Record<string, unknown> | null;
    defaultTags?: unknown;
  },
) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.storeMockupTemplate.update({
      where: { id: templateId },
      data: {
        name: data.name,
        printifyBlueprintId: data.printifyBlueprintId,
        printifyPrintProviderId: data.printifyPrintProviderId,
        blueprintTitle: data.blueprintTitle,
        printProviderTitle: data.printProviderTitle,
        previewUrl: data.previewUrl !== undefined ? data.previewUrl : undefined,
        position: data.position,
        enabledVariantIds: data.enabledVariantIds,
        enabledSizes: data.enabledSizes,
        defaultPlacement: data.defaultPlacement ?? undefined,
        defaultAspectRatio: data.defaultAspectRatio,
        storePresetSnapshot: data.storePresetSnapshot ?? undefined,
        printAreasByView: data.printAreasByView ?? undefined,
        blueprintImageUrl: data.blueprintImageUrl,
        blueprintBrand: data.blueprintBrand,
        defaultMockupSource: data.defaultMockupSource,
        basePriceUsd:
          data.basePriceUsd === undefined
            ? undefined
            : normalizeMoneyValue(data.basePriceUsd),
        priceBySizeDefault:
          data.priceBySizeDefault === undefined
            ? undefined
            : normalizePriceBySizeDefault(data.priceBySizeDefault) ?? Prisma.DbNull,
      },
    });

    if (data.defaultTags !== undefined) {
      await updateTemplateDefaultTags(templateId, data.defaultTags, tx);
    }

    if (data.colorIds !== undefined) {
      await tx.templateColor.deleteMany({ where: { templateId } });
      if (data.colorIds.length > 0) {
        await tx.templateColor.createMany({
          data: data.colorIds.map((colorId, i) => ({
            templateId,
            colorId,
            sortOrder: i,
          })),
        });
      }
    }

    return template;
  });
}

/**
 * Delete a template by ID
 */
export async function deleteTemplate(templateId: string) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.storeMockupTemplate.findUnique({
      where: { id: templateId },
      select: { storeId: true, isDefault: true },
    });

    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    await tx.storeMockupTemplate.delete({ where: { id: templateId } });

    if (template.isDefault) {
      const nextTemplates = await tx.storeMockupTemplate.findMany({
        where: { storeId: template.storeId },
        orderBy: { sortOrder: "asc" },
        include: { colors: true },
      });
      const nextTemplate = pickNextReadyDefaultTemplate(nextTemplates);
      if (nextTemplate) {
        await tx.storeMockupTemplate.update({
          where: { id: nextTemplate.id },
          data: { isDefault: true },
        });
      }
    }
  });
}

/**
 * Set a template as default for a store
 */
export async function setDefaultTemplate(storeId: string, templateId: string) {
  const template = await prisma.storeMockupTemplate.findFirst({
    where: { id: templateId, storeId },
    include: { colors: true },
  });

  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  assertTemplateReadyForDefault(template);

  return prisma.$transaction([
    prisma.storeMockupTemplate.updateMany({
      where: { storeId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.storeMockupTemplate.update({
      where: { id: templateId },
      data: { isDefault: true },
    }),
  ]);
}

/**
 * Duplicate an existing template
 */
export async function duplicateTemplate(templateId: string) {
  const original = await prisma.storeMockupTemplate.findUnique({
    where: { id: templateId },
    include: { colors: true },
  });

  if (!original) {
    throw new Error(`Template ${templateId} not found`);
  }

  const existingCount = await prisma.storeMockupTemplate.count({
    where: { storeId: original.storeId },
  });
  const originalDefaultTags = (await loadTemplateDefaultTags([templateId])).get(templateId) ?? [];

  return prisma.$transaction(async (tx) => {
    const copy = await tx.storeMockupTemplate.create({
      data: {
        storeId: original.storeId,
        name: `${original.name} (Copy)`,
        printifyBlueprintId: original.printifyBlueprintId,
        printifyPrintProviderId: original.printifyPrintProviderId,
        blueprintTitle: original.blueprintTitle,
        printProviderTitle: original.printProviderTitle,
        previewUrl: original.previewUrl,
        position: original.position,
        isDefault: false,
        enabledVariantIds: original.enabledVariantIds,
        enabledSizes: original.enabledSizes,
        defaultPlacement: original.defaultPlacement ?? undefined,
        defaultAspectRatio: original.defaultAspectRatio,
        storePresetSnapshot: original.storePresetSnapshot ?? undefined,
        printAreasByView: original.printAreasByView ?? undefined,
        blueprintImageUrl: original.blueprintImageUrl,
        blueprintBrand: original.blueprintBrand,
        basePriceUsd: original.basePriceUsd,
        priceBySizeDefault: original.priceBySizeDefault ?? undefined,
        defaultMockupSource: original.defaultMockupSource,
        sortOrder: existingCount,
      },
    });

    await updateTemplateDefaultTags(copy.id, originalDefaultTags, tx);

    if (original.colors.length > 0) {
      await tx.templateColor.createMany({
        data: original.colors.map((c) => ({
          templateId: copy.id,
          colorId: c.colorId,
          sortOrder: c.sortOrder,
        })),
      });
    }

    return copy;
  });
}

/**
 * Update just the placement preset for a specific template
 */
export async function updateTemplatePlacement(
  templateId: string,
  defaultPlacement: Prisma.InputJsonValue,
) {
  return prisma.storeMockupTemplate.update({
    where: { id: templateId },
    data: { defaultPlacement },
  });
}

/**
 * Get default template for a store
 */
export async function getDefaultTemplate(storeId: string) {
  return prisma.storeMockupTemplate.findFirst({
    where: { storeId, isDefault: true },
    include: {
      colors: {
        orderBy: { sortOrder: "asc" },
        include: { color: true },
      },
    },
  });
}
