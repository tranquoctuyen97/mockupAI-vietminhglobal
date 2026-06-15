# Shopify Smart Collections and Printify Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove direct Shopify collection syncing and enrich Shopify product tags from an existing Printify draft product when safe.

**Architecture:** Shopify publish will omit `collections` entirely so Shopify Smart Collections own collection membership. The publish worker will add a best-effort tag enrichment step before Shopify publish, fetching tags only from an existing Printify draft product ID and falling back to `listing.tags ?? []` for all missing/error/internal-only cases. `publishToShopify()` remains responsible for prepending and deduplicating default product-type tags.

**Tech Stack:** Next.js 16.2.4, TypeScript, Prisma, Node `node:test`, Shopify Admin GraphQL `productSet`, Printify REST API client.

---

## File Structure

- Modify `src/lib/publish/shopify.ts`
  - Remove manual collection resolution from `productSet`.
  - Keep taxonomy category, vendor, product type, tags, variants, and media behavior unchanged.

- Modify `src/lib/publish/worker.ts`
  - Export `normalizeExternalTags()` as a pure helper.
  - Export `resolvePrintifyTagsForShopify()` as a non-throwing best-effort helper.
  - Resolve existing `draftDesign.printifyDraftProductId ?? draft.printifyDraftProductId` before Shopify publish and use Printify tags only when normalized tags are non-empty.

- Modify `src/lib/printify/client.ts`
  - Add `tags?: unknown` to `PrintifyProductResponse`.

- Modify `src/lib/publish/shopify.test.ts`
  - Add default tag duplicate coverage.
  - Add a source-level regression test that `shopify.ts` does not send `collections` through `productSet`.

- Modify `src/lib/publish/worker.test.ts`
  - Add unit coverage for tag normalization and best-effort Printify tag fetch.

## Task 1: Remove Shopify Collection Sync

**Files:**
- Modify: `src/lib/publish/shopify.ts`
- Test: `src/lib/publish/shopify.test.ts`

- [ ] **Step 1: Write failing Shopify collection regression tests**

Add `readFileSync` import and these tests to `src/lib/publish/shopify.test.ts`.

```ts
import { readFileSync } from "node:fs";
```

```ts
describe("Shopify productSet collections", () => {
  const source = readFileSync(new URL("./shopify.ts", import.meta.url), "utf8");

  it("does not resolve or send collections through productSet", () => {
    assert.doesNotMatch(source, /resolveCollectionIds/);
    assert.doesNotMatch(source, /productSetInput\.collections/);
    assert.doesNotMatch(source, /PRODUCT_TYPE_COLLECTION_MAP/);
  });

  it("documents intentional Smart Collection ownership", () => {
    assert.match(source, /Intentionally omit collections/);
    assert.match(source, /Shopify Smart Collections will auto-include products/);
  });
});
```

- [ ] **Step 2: Run Shopify tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts
```

Expected: FAIL because `shopify.ts` still contains `PRODUCT_TYPE_COLLECTION_MAP`, `resolveCollectionIds`, and `productSetInput.collections`.

- [ ] **Step 3: Remove collection map and resolver from Shopify publish**

In `src/lib/publish/shopify.ts`, delete this constant:

```ts
/** Canonical apparel type -> manual collection title to resolve (exact title/handle only). */
const PRODUCT_TYPE_COLLECTION_MAP: Record<string, string> = {
  "T-Shirt": "T-Shirts",
  "Tank Top": "Tank Tops",
  Sweater: "Sweaters",
  Hoodie: "Hoodies",
  Sweatshirt: "Sweatshirts",
  "Long Sleeve Shirt": "Long Sleeve Shirts",
  Polo: "Polos",
};
```

Delete the `toHandle()` function and the entire `resolveCollectionIds()` function near the bottom of the file.

- [ ] **Step 4: Change category resolution to avoid collection lookup**

Replace:

```ts
const [categoryId, collectionIds] = await Promise.all([
  resolveCategoryId(client, canonicalType),
  resolveCollectionIds(client, canonicalType),
]);
```

with:

```ts
const categoryId = await resolveCategoryId(client, canonicalType);
```

- [ ] **Step 5: Remove `productSetInput.collections` assignment**

Replace:

```ts
if (categoryId) productSetInput.category = categoryId;
// Guard: only send collections when resolved exactly. Omitting (vs []) avoids
// clearing existing collections and lets automated collections match via
// productType / vendor / tags.
if (collectionIds.length > 0) productSetInput.collections = collectionIds;
```

with:

```ts
if (categoryId) productSetInput.category = categoryId;
// Intentionally omit collections.
// Shopify Smart Collections will auto-include products based on
// productType / vendor / category / tags rules configured in Shopify.
```

- [ ] **Step 6: Update file header flow comment**

Replace the first flow line:

```ts
 * 1. productSet — atomic: title, descriptionHtml, vendor, productType, category,
 *    collections, tags, options (Color + Size), variants (SKU, CONTINUE), status ACTIVE
```

with:

```ts
 * 1. productSet — atomic: title, descriptionHtml, vendor, productType, category,
 *    tags, options (Color + Size), variants (SKU, CONTINUE), status ACTIVE
```

- [ ] **Step 7: Run Shopify tests and verify pass**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/lib/publish/shopify.ts src/lib/publish/shopify.test.ts
git commit -m "fix: omit shopify collections from productSet"
```

## Task 2: Add Printify Product Tags Boundary Type

**Files:**
- Modify: `src/lib/printify/client.ts`

- [ ] **Step 1: Add `tags?: unknown` to `PrintifyProductResponse`**

In `src/lib/printify/client.ts`, change:

```ts
export interface PrintifyProductResponse {
  id: string;
  title: string;
  blueprint_id: number;
  print_provider_id: number;
  images?: PrintifyProductImage[];
  variants?: PrintifyProductVariant[];
  options?: PrintifyProductOption[];
  external?: { id: string; handle?: string };
}
```

to:

```ts
export interface PrintifyProductResponse {
  id: string;
  title: string;
  blueprint_id: number;
  print_provider_id: number;
  tags?: unknown;
  images?: PrintifyProductImage[];
  variants?: PrintifyProductVariant[];
  options?: PrintifyProductOption[];
  external?: { id: string; handle?: string };
}
```

- [ ] **Step 2: Run type-adjacent Printify tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/product.test.ts
```

Expected: PASS. Existing test fakes that omit `tags` remain valid because the field is optional.

- [ ] **Step 3: Commit Task 2**

```bash
git add src/lib/printify/client.ts
git commit -m "chore: expose printify product tags in response type"
```

## Task 3: Add Worker Tag Normalization Helpers

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Test: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Write failing `normalizeExternalTags()` tests**

Add `normalizeExternalTags` to the existing import list in `src/lib/publish/worker.test.ts`.

```ts
import {
  normalizeExternalTags,
  orderMockupImagesByPrimary,
  pickPrimaryColorName,
  resolvePublishVariantIds,
  resolveShopifyMockupMedia,
  validateVariantSkus,
} from "./worker";
```

Add this test block:

```ts
describe("normalizeExternalTags", () => {
  it("trims, drops blank/nullish tags, deduplicates case-insensitively, and preserves first casing", () => {
    assert.deepEqual(
      normalizeExternalTags([
        " Women's Clothing ",
        "women's clothing",
        "",
        "   ",
        null,
        undefined,
        "Unisex",
      ]),
      ["Women's Clothing", "Unisex"],
    );
  });

  it("removes internal mockup draft tags", () => {
    assert.deepEqual(
      normalizeExternalTags(["mockupai", "DRAFT-PREVIEW", "Cotton"]),
      ["Cotton"],
    );
  });

  it("returns an empty array for non-array input", () => {
    assert.deepEqual(normalizeExternalTags("Cotton"), []);
    assert.deepEqual(normalizeExternalTags(null), []);
  });
});
```

- [ ] **Step 2: Run worker tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because `normalizeExternalTags` is not exported.

- [ ] **Step 3: Implement normalization helper**

Add this near the top of `src/lib/publish/worker.ts`, after the existing constants:

```ts
const INTERNAL_TAG_DENYLIST = new Set(["mockupai", "draft-preview"]);
```

Add this exported helper near other exported pure helpers:

```ts
export function normalizeExternalTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (INTERNAL_TAG_DENYLIST.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(tag);
  }

  return out;
}
```

- [ ] **Step 4: Run worker tests and verify pass**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/lib/publish/worker.ts src/lib/publish/worker.test.ts
git commit -m "feat: normalize external printify tags"
```

## Task 4: Add Best-Effort Printify Tag Fetch Helper

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Test: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add `resolvePrintifyTagsForShopify` to the worker test import list:

```ts
import {
  normalizeExternalTags,
  orderMockupImagesByPrimary,
  pickPrimaryColorName,
  resolvePrintifyTagsForShopify,
  resolvePublishVariantIds,
  resolveShopifyMockupMedia,
  validateVariantSkus,
} from "./worker";
```

Add this test block:

```ts
describe("resolvePrintifyTagsForShopify", () => {
  it("returns normalized tags from an existing Printify product", async () => {
    const client = {
      getProduct: async (shopId: number, productId: string) => {
        assert.equal(shopId, 123);
        assert.equal(productId, "printify-product-1");
        return { id: productId, title: "Product", tags: [" Printify ", "mockupai", "Unisex"] };
      },
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      ["Printify", "Unisex"],
    );
  });

  it("returns an empty array for missing context", async () => {
    const client = {
      getProduct: async () => {
        throw new Error("should not be called");
      },
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: null,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: null,
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );
  });

  it("returns an empty array for internal-only tags", async () => {
    const client = {
      getProduct: async () => ({
        id: "printify-product-1",
        title: "Product",
        tags: ["mockupai", "draft-preview"],
      }),
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );
  });

  it("does not throw when Printify fetch fails", async () => {
    const client = {
      getProduct: async () => {
        throw new Error("Printify unavailable");
      },
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );
  });
});
```

- [ ] **Step 2: Run worker tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because `resolvePrintifyTagsForShopify` is not exported.

- [ ] **Step 3: Add helper input type**

Add this type near the other worker-local types in `src/lib/publish/worker.ts`:

```ts
type PrintifyTagsClient = {
  getProduct: (shopId: number, productId: string) => Promise<{ tags?: unknown }>;
};
```

- [ ] **Step 4: Implement best-effort helper**

Add this exported helper near `normalizeExternalTags()`:

```ts
export async function resolvePrintifyTagsForShopify(input: {
  client: PrintifyTagsClient;
  externalShopId: number | null | undefined;
  productId: string | null | undefined;
  storeId: string;
  listingId: string;
}): Promise<string[]> {
  if (!input.externalShopId || !input.productId) return [];

  try {
    const product = await input.client.getProduct(input.externalShopId, input.productId);
    return normalizeExternalTags(product.tags);
  } catch (err) {
    console.warn("[PublishWorker] Failed to fetch Printify tags, falling back to listing tags:", {
      productId: input.productId,
      storeId: input.storeId,
      listingId: input.listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
```

This log includes only safe identifiers and an error message. It must not include API keys, Shopify tokens, or Printify credentials.

- [ ] **Step 5: Run worker tests and verify pass**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/lib/publish/worker.ts src/lib/publish/worker.test.ts
git commit -m "feat: fetch existing printify tags for shopify"
```

## Task 5: Wire Tag Enrichment Into Shopify Publish

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Test: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Write pure selection helper tests**

Add `selectTagsForShopify` to the worker test import list:

```ts
import {
  normalizeExternalTags,
  orderMockupImagesByPrimary,
  pickPrimaryColorName,
  resolvePrintifyTagsForShopify,
  resolvePublishVariantIds,
  resolveShopifyMockupMedia,
  selectTagsForShopify,
  validateVariantSkus,
} from "./worker";
```

Add this test block:

```ts
describe("selectTagsForShopify", () => {
  it("uses normalized Printify tags when present", () => {
    assert.deepEqual(selectTagsForShopify(["Unisex"], ["summer"]), ["Unisex"]);
  });

  it("falls back to listing tags when Printify tags are empty", () => {
    assert.deepEqual(selectTagsForShopify([], ["summer"]), ["summer"]);
  });

  it("falls back to an empty array when both sources are empty or nullish", () => {
    assert.deepEqual(selectTagsForShopify([], null), []);
    assert.deepEqual(selectTagsForShopify([], undefined), []);
  });
});
```

- [ ] **Step 2: Run worker tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because `selectTagsForShopify` is not exported.

- [ ] **Step 3: Implement selection helper**

Add this exported helper near the tag helpers in `src/lib/publish/worker.ts`:

```ts
export function selectTagsForShopify(
  printifyTags: string[],
  listingTags: string[] | null | undefined,
): string[] {
  return printifyTags.length > 0 ? printifyTags : (listingTags ?? []);
}
```

- [ ] **Step 4: Resolve existing Printify draft product ID before Shopify publish**

In `runPublishWorker`, the variables `draftDesign` and `draft` are already available before Stage 1. Add this before `let shopifyResult`:

```ts
const existingPrintifyDraftProductId =
  draftDesign?.printifyDraftProductId ?? draft.printifyDraftProductId ?? null;
```

- [ ] **Step 5: Compute `tagsForShopify` before the Shopify retry block**

Inside the non-dry-run Shopify branch, after variant plan resolution and before `retryWithBackoff()`, add:

```ts
let printifyTagsForShopify: string[] = [];
if (existingPrintifyDraftProductId) {
  try {
    const { client: printifyClient, externalShopId } = await getClientForStore(store.id);
    printifyTagsForShopify = await resolvePrintifyTagsForShopify({
      client: printifyClient,
      externalShopId,
      productId: existingPrintifyDraftProductId,
      storeId: store.id,
      listingId,
    });
  } catch (err) {
    console.warn("[PublishWorker] Failed to resolve Printify account for tag lookup:", {
      productId: existingPrintifyDraftProductId,
      storeId: store.id,
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
const tagsForShopify = selectTagsForShopify(printifyTagsForShopify, listing.tags);
```

This block must not call `retryWithBackoff()` and must not create, update, publish, delete, or clear any Printify product.

- [ ] **Step 6: Pass selected tags to Shopify**

Replace the current `publishToShopify()` input field:

```ts
tags: listing.tags,
```

with:

```ts
tags: tagsForShopify,
```

- [ ] **Step 7: Run worker tests and verify pass**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/lib/publish/worker.ts src/lib/publish/worker.test.ts
git commit -m "feat: use existing printify tags for shopify publish"
```

## Task 6: Extend Shopify Tag Coverage

**Files:**
- Modify: `src/lib/publish/shopify.test.ts`

- [ ] **Step 1: Add Printify tag acceptance tests**

Add these tests to the existing `describe("buildProductTags", ...)` block in `src/lib/publish/shopify.test.ts`:

```ts
it("prepends defaults to external Printify tags", () => {
  assert.deepEqual(
    buildProductTags("T-Shirt", ["Women's Clothing", "Unisex", "DTG", "Cotton"]),
    ["T-Shirt", "Printify", "Women's Clothing", "Unisex", "DTG", "Cotton"],
  );
});

it("returns default tags when no external or listing tags are available", () => {
  assert.deepEqual(buildProductTags("T-Shirt", []), ["T-Shirt", "Printify"]);
});

it("deduplicates external tags that overlap with defaults", () => {
  assert.deepEqual(
    buildProductTags("T-Shirt", ["Printify", "T-Shirt", "Unisex"]),
    ["T-Shirt", "Printify", "Unisex"],
  );
});
```

- [ ] **Step 2: Run Shopify tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit Task 6**

```bash
git add src/lib/publish/shopify.test.ts
git commit -m "test: cover printify tag merge behavior"
```

## Task 7: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused publish and Printify tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts src/lib/publish/worker.test.ts src/lib/printify/product.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS. If unrelated existing build errors appear, capture the exact file/error and do not hide them.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect final diff for forbidden behavior**

Run:

```bash
rg -n "resolveCollectionIds|productSetInput\\.collections|PRODUCT_TYPE_COLLECTION_MAP|toHandle" src/lib/publish/shopify.ts
```

Expected: no matches.

Run:

```bash
rg -n "tags: tagsForShopify|resolvePrintifyTagsForShopify|normalizeExternalTags|selectTagsForShopify" src/lib/publish/worker.ts src/lib/publish/worker.test.ts
```

Expected: matches for the new helper definitions, tests, and `tags: tagsForShopify`.

- [ ] **Step 5: Commit final verification updates if any**

If final verification required fixes, commit them:

```bash
git add src/lib/publish/shopify.ts src/lib/publish/shopify.test.ts src/lib/publish/worker.ts src/lib/publish/worker.test.ts src/lib/printify/client.ts
git commit -m "fix: align smart collections tag publish verification"
```

If no files changed after Task 6, do not create an empty commit.

## Notes for Implementer

- Keep all imports static and top-level.
- Do not introduce dynamic imports in `worker.ts` or `shopify.ts`.
- Do not log credentials, encrypted tokens, raw API keys, or request headers.
- Do not call `createOrUpdatePrintifyProduct()`, `publishToPrintify()`, or `publishExistingPrintifyDraftProduct()` from tag enrichment.
- Do not move the Printify stage before the Shopify stage.
- Shopify Smart Collections require customer-side Shopify rules; this app only provides product fields for those rules to match.
