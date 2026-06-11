/**
 * Printify Variant Catalog — Cost Cache via Dummy Product Strategy
 *
 * The Printify Catalog API (/catalog/blueprints/.../variants.json) does NOT
 * return cost, is_available, or sku per variant. Those fields only appear in
 * Shop Product responses (/shops/{id}/products/{id}.json).
 *
 * Strategy (Hybrid):
 *   1. Create a dummy product with ≤100 variants enabled (Printify hard limit),
 *      remaining variants disabled. Read cost data from the response.
 *   2. If any disabled variants are missing cost data, create additional batch
 *      dummy products (≤100 enabled each) to fill the gaps.
 *   3. Merge all cost data, cache in PrintifyVariantCache, delete all dummies.
 */

import { prisma } from "@/lib/db";
import type {
  PrintifyClient,
  PrintifyProductResponse,
  PrintifyProductOption,
} from "./client";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DUMMY_PRODUCT_TITLE_PREFIX = "[INTERNAL_COST_LOOKUP]";

/** Printify hard limit: max 100 variants with is_enabled: true per product */
const MAX_ENABLED_VARIANTS = 100;

/** Delay between batch dummy product creations to avoid overloading Printify */
const BATCH_DELAY_MS = 2000;

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
 * In-flight lock map: prevents concurrent Printify dummy product creation for
 * the same blueprint+provider pair. Without this, two parallel requests each
 * create a dummy product (~30s each), doubling both time and Printify API load.
 *
 * When a second call arrives while the first is in-flight, it waits for the
 * first's promise and returns the same result.
 */
const inFlightCache = new Map<string, Promise<CachedVariant[]>>();

/**
 * Ensure variant cost cache exists for blueprint+provider.
 * Creates dummy product(s) on Printify to fetch costs, then deletes them.
 *
 * Hybrid strategy:
 *   - First dummy: ≤100 enabled + rest disabled (single API call for most cases)
 *   - If disabled variants lack cost data, creates batch dummies for the gaps
 *
 * Idempotent: if cache is fresh (<7 days), returns cached data.
 * Concurrent-safe: in-memory lock + DB compound key + delete-then-insert.
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

  // 1b. Concurrent lock — if another request is already building this cache, wait for it
  const lockKey = `${blueprintId}:${printProviderId}`;
  const existing = inFlightCache.get(lockKey);
  if (existing) {
    console.log(`[variant-cache] Waiting for in-flight cache build: ${lockKey}`);
    return existing;
  }

  const promise = _buildVariantCostCache(input);
  inFlightCache.set(lockKey, promise);

  try {
    return await promise;
  } finally {
    inFlightCache.delete(lockKey);
  }
}

/**
 * Internal: actually builds the variant cost cache via Printify dummy products.
 * Called only by ensureVariantCostCache after lock acquisition.
 */
async function _buildVariantCostCache(input: {
  client: PrintifyClient;
  shopId: number;
  blueprintId: number;
  printProviderId: number;
  forceRefresh?: boolean;
}): Promise<CachedVariant[]> {
  const { client, shopId, blueprintId, printProviderId } = input;

  // 2. Fetch catalog variants (only has id, title, options.color, options.size)
  const catalogResponse = await client.getBlueprintVariants(
    blueprintId,
    printProviderId,
  );
  const catalogVariants = catalogResponse.variants;

  // ── Sync print area from placeholders (first variant) ──
  if (catalogVariants.length > 0) {
    const firstVariant = catalogVariants[0];
    if (firstVariant.placeholders?.length) {
      const DPI = 300;
      const PX_TO_MM = 25.4 / DPI;
      for (const ph of firstVariant.placeholders) {
        if (!ph.width || !ph.height) continue;
        const widthMm = Math.round(ph.width * PX_TO_MM * 10) / 10;
        const heightMm = Math.round(ph.height * PX_TO_MM * 10) / 10;
        const position = ph.position.toUpperCase() as any;
        try {
          await prisma.blueprintPrintArea.upsert({
            where: {
              printifyBlueprintId_position: {
                printifyBlueprintId: blueprintId,
                position,
              },
            } as any,
            create: { printifyBlueprintId: blueprintId, position, widthMm, heightMm },
            update: { widthMm, heightMm, syncedAt: new Date() },
          });
        } catch (e) {
          console.warn(`[variant-cache] Failed to sync print area for blueprint ${blueprintId} / ${ph.position}:`, e);
        }
      }
      console.log(`[variant-cache] Synced print area for blueprint ${blueprintId}: ${firstVariant.placeholders.length} positions`);
    }
  }

  if (catalogVariants.length === 0) {
    throw new Error(
      `No variants found for blueprint ${blueprintId} / provider ${printProviderId}`,
    );
  }

  // 3. Upload tiny dummy design image (1x1 transparent PNG)
  const dummyImageId = await uploadDummyDesignImage(client);

  // 4. Build dummy product payload — first 100 enabled, rest disabled
  //    Printify hard limit: max 100 variants with is_enabled: true
  if (catalogVariants.length > MAX_ENABLED_VARIANTS) {
    console.log(
      `[variant-cache] Blueprint ${blueprintId}: ${catalogVariants.length} variants, ` +
      `enabling first ${MAX_ENABLED_VARIANTS}, disabling ${catalogVariants.length - MAX_ENABLED_VARIANTS}`,
    );
  }

  const dummyPayload = {
    title: `${DUMMY_PRODUCT_TITLE_PREFIX} ${blueprintId}/${printProviderId} ${Date.now()}`,
    description: "Internal product to fetch variant costs. Auto-deleted.",
    blueprint_id: blueprintId,
    print_provider_id: printProviderId,
    variants: catalogVariants.map((v, idx) => ({
      id: v.id,
      price: 100, // $1.00 placeholder — Printify requires non-zero
      is_enabled: idx < MAX_ENABLED_VARIANTS,
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

  // Track all dummy product IDs for cleanup
  const dummyProductIds: string[] = [];

  // 5. Create dummy product → response includes cost, sku, is_available per variant
  let dummyProduct: PrintifyProductResponse | null = null;
  try {
    dummyProduct = await client.createProduct(shopId, dummyPayload);
    dummyProductIds.push(dummyProduct.id);

    const shopVariants = dummyProduct.variants ?? [];

    // 5a. Collect cost data from response into a map
    const costMap = new Map<number, { cost: number; sku: string | null; isAvailable: boolean }>();
    for (const sv of shopVariants) {
      if (sv.cost !== undefined && sv.cost !== null) {
        costMap.set(sv.id, {
          cost: sv.cost,
          sku: sv.sku ?? null,
          isAvailable: sv.is_available ?? true,
        });
      }
    }

    // 5b. Check which variants are missing cost data (disabled variants may not return cost)
    const missingCostIds = catalogVariants
      .map((cv) => cv.id)
      .filter((id) => !costMap.has(id));

    // 6. Batch fallback — create additional dummies for variants missing cost
    if (missingCostIds.length > 0) {
      console.warn(
        `[variant-cache] ${missingCostIds.length}/${catalogVariants.length} ` +
        `variants missing cost after dummy #1. Creating batch fallback.`,
      );

      for (let i = 0; i < missingCostIds.length; i += MAX_ENABLED_VARIANTS) {
        // Delay between batches to avoid overloading Printify product creation
        if (i > 0) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }

        const chunk = missingCostIds.slice(i, i + MAX_ENABLED_VARIANTS);
        const batchPayload = {
          title: `${DUMMY_PRODUCT_TITLE_PREFIX} batch ${blueprintId}/${printProviderId} ${Date.now()}`,
          description: "Batch cost lookup. Auto-deleted.",
          blueprint_id: blueprintId,
          print_provider_id: printProviderId,
          variants: chunk.map((id) => ({ id, price: 100, is_enabled: true })),
          print_areas: [
            {
              variant_ids: chunk,
              placeholders: [
                {
                  position: "front",
                  images: [
                    { id: dummyImageId, x: 0.5, y: 0.5, scale: 0.1, angle: 0 },
                  ],
                },
              ],
            },
          ],
        };

        try {
          const batchProduct = await client.createProduct(shopId, batchPayload);
          dummyProductIds.push(batchProduct.id);

          for (const sv of batchProduct.variants ?? []) {
            if (sv.cost != null && !costMap.has(sv.id)) {
              costMap.set(sv.id, {
                cost: sv.cost,
                sku: sv.sku ?? null,
                isAvailable: sv.is_available ?? true,
              });
            }
          }
        } catch (batchErr) {
          // Non-fatal: variants in this batch will use cost=0 fallback
          console.warn(
            `[variant-cache] Batch ${Math.floor(i / MAX_ENABLED_VARIANTS) + 1} failed:`,
            batchErr,
          );
        }
      }

      const stillMissing = catalogVariants.filter((cv) => !costMap.has(cv.id)).length;
      if (stillMissing > 0) {
        console.warn(
          `[variant-cache] ${stillMissing} variants still missing cost after batch fallback. Using cost=0.`,
        );
      }
    }

    // 7. Build option_id → value lookup from product.options[]
    //    (color hex + size names come from here, NOT from a separate endpoint)
    const optionLookup = buildOptionValueLookupFromProduct(
      dummyProduct.options ?? [],
    );

    // 8. Merge catalog data (color/size names) + cost data (from costMap with sv fallback)
    const merged: CachedVariant[] = catalogVariants.map((cv) => {
      const sv = shopVariants.find((s) => s.id === cv.id);
      const costData = costMap.get(cv.id);
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
        sku: costData?.sku ?? sv?.sku ?? null,
        costCents: costData?.cost ?? sv?.cost ?? 0,
        isAvailable: costData?.isAvailable ?? sv?.is_available ?? true,
      };
    });

    // 9. UPSERT cache: delete old, then batch-insert new.
    // Sequential (not $transaction) to avoid P2028 timeout — connection pool
    // is often exhausted after a long Printify API call (~10-16s). The cache
    // table is idempotent: stale rows are harmless, fresh rows overwrite them.
    await prisma.printifyVariantCache.deleteMany({
      where: { blueprintId, printProviderId },
    });
    await prisma.printifyVariantCache.createMany({
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
    });

    return merged;
  } finally {
    // 10. Cleanup — always delete ALL dummy products, even on error
    for (const productId of dummyProductIds) {
      try {
        await client.deleteProduct(shopId, productId);
      } catch (err) {
        // Non-fatal — orphan cleanup cron will retry
        console.warn(
          `[variant-cache] Failed to delete dummy product ${productId}:`,
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
 * Per-color variant matrix computation.
 *
 * Each color has its own set of enabled sizes via `enabledSizesByColor`.
 * Falls back to `fallbackSizes` (global list) when a color has no entry in the map.
 *
 * Key matching is case-insensitive to handle minor casing differences between
 * store config and Printify catalog data.
 */
export function computeVariantMatrixPerColor(
  variants: CachedVariant[],
  selectedColorNames: string[],
  enabledSizesByColor: Record<string, string[]>,
  fallbackSizes: string[] = [],
): number[] {
  const colorSet = new Set(selectedColorNames.map((c) => c.trim().toLowerCase()));

  // Build a lowercase-keyed lookup for the size map
  const lowerSizesMap = new Map<string, Set<string>>();
  for (const [colorName, sizes] of Object.entries(enabledSizesByColor)) {
    lowerSizesMap.set(colorName.trim().toLowerCase(), new Set(sizes));
  }
  const fallbackSizeSet = new Set(fallbackSizes);

  return variants
    .filter((v) => {
      if (!v.isAvailable) return false;
      const lowerColor = v.colorName.trim().toLowerCase();
      if (!colorSet.has(lowerColor)) return false;

      // Per-color sizes, with fallback to global list
      const sizesForColor = lowerSizesMap.get(lowerColor) ?? fallbackSizeSet;
      return sizesForColor.has(v.size);
    })
    .map((v) => v.variantId);
}

/**
 * Build full variants array for Printify product payload (includes computed retail price, sku, status).
 * `baseRetailPriceUSD` is mapped to the lowest-cost available size.
 * `priceBySizeOverride` — optional map of { sizeName → priceUSD } to override auto-calculation.
 */
export function buildVariantPayload(
  variants: CachedVariant[],
  selectedColorNames: string[],
  selectedSizes: string[],
  baseRetailPriceUSD: number,
  priceBySizeOverride?: Record<string, number> | null,
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
    
    // Per-size override takes priority; otherwise auto-calculate: baseRetail + costDelta
    const overridePrice = priceBySizeOverride?.[v.size];
    const costDeltaCents = v.costCents - validMinCost;
    const retailPriceCents = overridePrice != null
      ? Math.round(overridePrice * 100)
      : Math.round(baseRetailPriceUSD * 100) + costDeltaCents;

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
