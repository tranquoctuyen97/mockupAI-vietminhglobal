/**
 * Printify Variant Catalog — Cost Cache via Dummy Product Strategy
 *
 * The Printify Catalog API (/catalog/blueprints/.../variants.json) does NOT
 * return cost, is_available, or sku per variant. Those fields only appear in
 * Shop Product responses (/shops/{id}/products/{id}.json).
 *
 * Strategy: create a dummy product with all variants enabled, read the response
 * to extract cost data, cache it in PrintifyVariantCache, then delete the dummy.
 */

import { prisma } from "@/lib/db";
import type {
  PrintifyClient,
  PrintifyProductResponse,
  PrintifyProductOption,
} from "./client";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DUMMY_PRODUCT_TITLE_PREFIX = "[INTERNAL_COST_LOOKUP]";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CachedVariant {
  variantId: number;
  colorName: string;
  colorHex: string | null;
  size: string;
  sku: string | null;
  costCents: number;
  isAvailable: boolean;
}

// ─── Main cache function ───────────────────────────────────────────────────────

/**
 * Ensure variant cost cache exists for blueprint+provider.
 * Creates dummy product on Printify to fetch costs, then deletes it.
 *
 * Idempotent: if cache is fresh (<7 days), returns cached data.
 * Concurrent-safe: DB uses compound key + delete-then-insert transaction.
 */
export async function ensureVariantCostCache(input: {
  client: PrintifyClient;
  shopId: number;
  blueprintId: number;
  printProviderId: number;
  forceRefresh?: boolean;
}): Promise<CachedVariant[]> {
  const { client, shopId, blueprintId, printProviderId, forceRefresh } = input;

  // 1. Check cache freshness
  if (!forceRefresh) {
    const cached = await prisma.printifyVariantCache.findMany({
      where: { blueprintId, printProviderId },
    });
    if (cached.length > 0) {
      const oldest = cached.reduce(
        (o, v) => (v.fetchedAt < o ? v.fetchedAt : o),
        new Date(),
      );
      if (Date.now() - oldest.getTime() < CACHE_TTL_MS) {
        return cached.map(toCachedVariant);
      }
    }
  }

  // 2. Fetch catalog variants (only has id, title, options.color, options.size)
  const catalogResponse = await client.getBlueprintVariants(
    blueprintId,
    printProviderId,
  );
  const catalogVariants = catalogResponse.variants;

  if (catalogVariants.length === 0) {
    throw new Error(
      `No variants found for blueprint ${blueprintId} / provider ${printProviderId}`,
    );
  }

  // 3. Upload tiny dummy design image (1x1 transparent PNG)
  const dummyImageId = await uploadDummyDesignImage(client);

  // 4. Build dummy product payload — all variants enabled, minimal design
  const dummyPayload = {
    title: `${DUMMY_PRODUCT_TITLE_PREFIX} ${blueprintId}/${printProviderId} ${Date.now()}`,
    description: "Internal product to fetch variant costs. Auto-deleted.",
    blueprint_id: blueprintId,
    print_provider_id: printProviderId,
    variants: catalogVariants.map((v) => ({
      id: v.id,
      price: 100, // $1.00 placeholder — Printify requires non-zero
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: catalogVariants.map((v) => v.id),
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: dummyImageId,
                x: 0.5,
                y: 0.5,
                scale: 0.1,
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  };

  // 5. Create dummy product → response includes cost, sku, is_available per variant
  let dummyProduct: PrintifyProductResponse | null = null;
  try {
    dummyProduct = await client.createProduct(shopId, dummyPayload);

    const shopVariants = dummyProduct.variants ?? [];

    // 6. Build option_id → value lookup from product.options[]
    //    (color hex + size names come from here, NOT from a separate endpoint)
    const optionLookup = buildOptionValueLookupFromProduct(
      dummyProduct.options ?? [],
    );

    // 7. Merge catalog data (color/size names) + shop data (cost/availability)
    const merged: CachedVariant[] = catalogVariants.map((cv) => {
      const sv = shopVariants.find((s) => s.id === cv.id);
      const optionIds = sv?.options ?? [];
      const colorOption = optionIds
        .map((id) => optionLookup.get(id))
        .find((o) => o?.type === "color");
      const colorHex = colorOption?.colors?.[0] ?? null;

      return {
        variantId: cv.id,
        colorName: cv.options.color ?? "Unknown",
        colorHex,
        size: cv.options.size ?? "ONE_SIZE",
        sku: sv?.sku ?? null,
        costCents: sv?.cost ?? 0,
        isAvailable: sv?.is_available ?? true,
      };
    });

    // 8. UPSERT cache (delete old + insert new in transaction)
    await prisma.$transaction([
      prisma.printifyVariantCache.deleteMany({
        where: { blueprintId, printProviderId },
      }),
      prisma.printifyVariantCache.createMany({
        data: merged.map((v) => ({
          blueprintId,
          printProviderId,
          variantId: v.variantId,
          colorName: v.colorName,
          colorHex: v.colorHex,
          size: v.size,
          sku: v.sku,
          costCents: v.costCents,
          isAvailable: v.isAvailable,
        })),
      }),
    ]);

    return merged;
  } finally {
    // 9. Cleanup — always delete dummy product, even on error
    if (dummyProduct?.id) {
      try {
        await client.deleteProduct(shopId, dummyProduct.id);
      } catch (err) {
        // Non-fatal — orphan cleanup cron will retry
        console.warn(
          `[variant-cache] Failed to delete dummy product ${dummyProduct.id}:`,
          err,
        );
      }
    }
  }
}

// ─── Size grouping ─────────────────────────────────────────────────────────────

export const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
];

export interface SizeGroup {
  size: string;
  availableColors: number;
  isAvailable: boolean;
  costCents: number;
  costDeltaCents: number; // delta vs smallest-size cost
}

/**
 * Group variants by unique sizes.
 * Computes cost delta relative to the smallest available size.
 */
export function groupSizes(variants: CachedVariant[]): SizeGroup[] {
  const sizeMap = new Map<string, CachedVariant[]>();
  for (const v of variants) {
    if (!sizeMap.has(v.size)) sizeMap.set(v.size, []);
    sizeMap.get(v.size)!.push(v);
  }

  const sortedSizes = Array.from(sizeMap.keys()).sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    // Unknown sizes fall to end, alphabetically
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const baseCostCents = sizeMap.get(sortedSizes[0])?.[0]?.costCents ?? 0;

  return sortedSizes.map((size) => {
    const sizeVariants = sizeMap.get(size)!;
    const availableColors = sizeVariants.filter((v) => v.isAvailable).length;
    const costCents = sizeVariants[0]?.costCents ?? 0;
    return {
      size,
      availableColors,
      isAvailable: availableColors > 0,
      costCents,
      costDeltaCents: costCents - baseCostCents,
    };
  });
}

// ─── Variant matrix computation ────────────────────────────────────────────────

export function computeVariantMatrix(
  variants: CachedVariant[],
  selectedColorNames: string[],
  selectedSizes: string[],
): number[] {
  const colorSet = new Set(
    selectedColorNames.map((c) => c.trim().toLowerCase()),
  );
  const sizeSet = new Set(selectedSizes);

  return variants
    .filter(
      (v) =>
        v.isAvailable &&
        colorSet.has(v.colorName.trim().toLowerCase()) &&
        sizeSet.has(v.size),
    )
    .map((v) => v.variantId);
}

/**
 * Build full variants array for Printify product payload (includes computed retail price, sku, status).
 * `baseRetailPriceUSD` is mapped to the lowest-cost available size.
 */
export function buildVariantPayload(
  variants: CachedVariant[],
  selectedColorNames: string[],
  selectedSizes: string[],
  baseRetailPriceUSD: number,
): Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }> {
  const colorSet = new Set(selectedColorNames.map((c) => c.trim().toLowerCase()));
  const sizeSet = new Set(selectedSizes);
  
  // Find minimum cost to calculate delta
  const minCostCents = variants.reduce((min, v) => (v.isAvailable && v.costCents < min ? v.costCents : min), Infinity);
  const validMinCost = minCostCents === Infinity ? 0 : minCostCents;

  let firstAvailable = true;

  return variants.map((v) => {
    const isSelected = colorSet.has(v.colorName.trim().toLowerCase()) && sizeSet.has(v.size);
    const isEnabled = isSelected && v.isAvailable;
    
    // Calculate retail price: baseRetail + costDelta
    const costDeltaCents = v.costCents - validMinCost;
    // Price in Printify API is in cents
    const retailPriceCents = Math.round(baseRetailPriceUSD * 100) + costDeltaCents;

    const payload: { id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean } = {
      id: v.variantId,
      price: Math.max(100, retailPriceCents), // Minimum $1.00 allowed by Printify
      is_enabled: isEnabled,
    };

    if (v.sku) {
      payload.sku = v.sku;
    }

    if (isEnabled && firstAvailable) {
      payload.is_default = true;
      firstAvailable = false;
    }

    return payload;
  });
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build option value lookup from product.options[] response.
 * Maps option value ID → { type, title, colors? }.
 *
 * product.options example:
 *   [
 *     { name: "Colors", type: "color", values: [{ id: 831, title: "Heather Grey", colors: ["#a4a4a3"] }] },
 *     { name: "Sizes",  type: "size",  values: [{ id: 14, title: "S" }] }
 *   ]
 */
function buildOptionValueLookupFromProduct(
  options: PrintifyProductOption[],
): Map<number, { type: string; title: string; colors?: string[] }> {
  const lookup = new Map<
    number,
    { type: string; title: string; colors?: string[] }
  >();
  for (const opt of options) {
    for (const val of opt.values ?? []) {
      lookup.set(val.id, {
        type: opt.type,
        title: val.title,
        colors: val.colors,
      });
    }
  }
  return lookup;
}

/**
 * Upload a 1x1 transparent PNG to Printify as placeholder design.
 * Used for dummy products to fetch variant costs.
 */
async function uploadDummyDesignImage(
  client: PrintifyClient,
): Promise<string> {
  // Smallest valid PNG — 1x1 transparent pixel
  const TRANSPARENT_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

  const result = await client.uploadImageBase64({
    fileName: "dummy_cost_lookup.png",
    contentsBase64: TRANSPARENT_PNG_BASE64,
  });
  return result.id;
}

function toCachedVariant(row: {
  variantId: number;
  colorName: string;
  colorHex: string | null;
  size: string;
  sku: string | null;
  costCents: number;
  isAvailable: boolean;
}): CachedVariant {
  return {
    variantId: row.variantId,
    colorName: row.colorName,
    colorHex: row.colorHex,
    size: row.size,
    sku: row.sku,
    costCents: row.costCents,
    isAvailable: row.isAvailable,
  };
}
