# Shopify Smart Collections and Printify Tag Enrichment Design

## Goal

Stop assigning Shopify collections directly during product publish. Shopify Smart Collections will own collection membership through rules configured in Shopify.

When an existing Printify draft product already has real external tags, use those tags for the Shopify product. If Printify tags are unavailable, empty, internal-only, or fetch fails, keep the current fallback behavior: use `listing.tags`, then let Shopify publishing add default product-type tags.

## Non-Goals

- Do not reorder the publish worker. Shopify publish remains before Printify publish.
- Do not create, update, publish, or clear any Printify product while resolving tags for Shopify.
- Do not depend on Printify Smart Suggest or any undocumented Printify tag-generation API.
- Do not create Shopify collections or Smart Collection rules from the app.
- Do not make Printify tag lookup a blocking publish requirement.

## Architecture

### Shopify Publish

`src/lib/publish/shopify.ts` will stop resolving and sending collections to `productSet`.

Changes:

- Remove the call to `resolveCollectionIds()`.
- Do not set `productSetInput.collections`.
- Delete `PRODUCT_TYPE_COLLECTION_MAP`, `resolveCollectionIds()`, and `toHandle()` if no longer used.
- Keep category, product type, vendor, tags, product options, variants, media upload, and publication behavior unchanged.

The product organization comment should state:

```ts
// Intentionally omit collections.
// Shopify Smart Collections will auto-include products based on
// productType / vendor / category / tags rules configured in Shopify.
```

This avoids `productSet` list-field synchronization for `collections`. Shopify's `productSet` treats list fields such as `collections`, `metafields`, and `variants` as sync lists: included entries are created or updated and entries not included can be removed. Omitting `collections` avoids updating that field and lets Shopify Smart Collections match products through configured conditions.

Smart Collections only work if the customer has already configured automated collection rules in Shopify, such as product type, vendor, category, title, or tag rules. The app will not create or manage those collection rules in this phase.

### Printify Tag Enrichment

`src/lib/publish/worker.ts` will enrich Shopify tags from an existing Printify draft product before calling `publishToShopify()`.

The worker keeps the current stage order:

1. Shopify stage.
2. Printify stage.

Before `publishToShopify()`, the worker tries to fetch tags from the existing publish draft product ID, using the same precedence already used by the Printify stage:

1. Per-design listing: `draftDesign.printifyDraftProductId`.
2. Legacy or single-design listing: `draft.printifyDraftProductId`.

This ID is treated only as an existing Printify draft product. The tag helper must not create, update, publish, delete, or clear Printify products.

If an existing product ID is present, the worker resolves Printify account context best-effort and calls:

```ts
resolvePrintifyTagsForShopify({
  client: printifyClient,
  externalShopId,
  productId,
  storeId: store.id,
  listingId,
})
```

The helper returns normalized tags or an empty array. It does not throw.

The Shopify tag choice is:

```ts
const tagsForShopify =
  printifyTags.length > 0
    ? printifyTags
    : listing.tags ?? [];
```

`publishToShopify()` still calls `buildProductTags(canonicalType, input.tags)`, so default tags such as `T-Shirt` and `Printify` are prepended and deduplicated in all cases.

## Components

### `normalizeExternalTags(tags: unknown): string[]`

Pure worker-level helper. It accepts untrusted external API data and returns a clean tag list.

Rules:

- Return `[]` when `tags` is not an array.
- Convert each value with `String(raw ?? "").trim()` and drop blank tags. This prevents `null` and `undefined` from becoming literal `"null"` or `"undefined"` tags.
- Remove internal tags using a lowercased denylist:
  - `mockupai`
  - `draft-preview`
- Deduplicate case-insensitively.
- Preserve the first display casing that survives filtering.

### `resolvePrintifyTagsForShopify(...)`

Best-effort worker helper.

Inputs:

- `client`: existing `PrintifyClient`.
- `externalShopId`: Printify shop ID.
- `productId`: existing Printify draft product ID.
- `storeId`: local store ID for diagnostics.
- `listingId`: local listing ID for diagnostics.

Behavior:

- Skip and return `[]` if `externalShopId` or `productId` is missing.
- Call `client.getProduct(externalShopId, productId)`.
- Return `normalizeExternalTags(printifyProduct.tags)`.
- Catch fetch or response errors and return `[]`.
- Log only non-sensitive diagnostics. Do not log credentials, tokens, or API keys. If logging is needed, include only safe identifiers such as `productId`, `storeId`, and `listingId`.
- Do not call `retryWithBackoff()`.
- Do not update Prisma records.

### Printify Response Type

If `PrintifyProductResponse` does not expose tags, add:

```ts
tags?: unknown;
```

The boundary type stays permissive because Printify is an external API and `normalizeExternalTags()` owns validation.

## Data Flow

1. Worker loads listing, store, credentials, draft, mockups, and variant plan as today.
2. Worker resolves the existing Printify draft product ID from `draftDesign.printifyDraftProductId` or `draft.printifyDraftProductId`.
3. If an ID exists, worker resolves Printify client/shop context best-effort.
4. Worker calls `resolvePrintifyTagsForShopify()` with `client`, `externalShopId`, `productId`, `storeId`, and `listingId`.
5. Worker computes `tagsForShopify`.
6. Worker passes `tagsForShopify` into `publishToShopify()`.
7. Shopify publish builds final tags with `buildProductTags()`.
8. Shopify `productSet` omits `collections`.
9. Printify stage continues afterward unchanged.

This phase does not change tag count limits or caps in any existing layer. `buildProductTags()` currently deduplicates and preserves order without a local `MAX_TAGS` cap, while AI listing generation/parsing still asks for and slices to 15 tags. If the customer later needs a larger generated tag set, that should be handled as a separate tag-generation phase.

## Error Handling

Printify tag lookup is non-critical metadata enrichment.

- Missing existing product ID: fallback to `listing.tags`.
- Missing Printify account or shop context: fallback to `listing.tags`.
- `client.getProduct()` fails: warn with safe IDs only and fallback to `listing.tags`.
- `tags` is missing, not an array, empty, or internal-only after filtering: fallback to `listing.tags`.
- No Printify tag lookup error can fail the Shopify publish job.
- No Printify tag lookup error can mark `PublishJob`, `Listing`, `WizardDraft`, or `WizardDraftDesign` failed or partial.

Existing Shopify publish errors remain handled by current Shopify retry and failure logic.

## Testing

### Shopify Tests

Update `src/lib/publish/shopify.test.ts` or add a focused mocked GraphQL test proving `productSet` variables do not include `collections`.

Keep or extend `buildProductTags()` coverage:

- Canonical `T-Shirt` plus `["Women's Clothing", "Unisex", "DTG", "Cotton"]` yields:

```ts
["T-Shirt", "Printify", "Women's Clothing", "Unisex", "DTG", "Cotton"]
```

- Canonical `T-Shirt` plus `[]` yields:

```ts
["T-Shirt", "Printify"]
```

- Canonical `T-Shirt` plus `["Printify", "T-Shirt", "Unisex"]` yields no duplicates:

```ts
["T-Shirt", "Printify", "Unisex"]
```

### Worker Tests

Add focused tests in `src/lib/publish/worker.test.ts` or an equivalent local test file:

- `normalizeExternalTags()` trims values, drops blanks, deduplicates case-insensitively, and preserves first display casing.
- `normalizeExternalTags()` removes `mockupai` and `draft-preview`.
- `resolvePrintifyTagsForShopify()` returns normalized tags for a fake client response.
- `resolvePrintifyTagsForShopify()` returns `[]` for empty, missing, non-array, or internal-only tags.
- `resolvePrintifyTagsForShopify()` returns `[]` when `getProduct()` throws and does not throw to the caller.
- Existing Printify tags win over `listing.tags`.
- Missing product ID or failed fetch falls back to `listing.tags`.
- Internal-only Printify tags fall back to `listing.tags`, then `publishToShopify()` still adds default tags.

## Acceptance Cases

### Case A

Input:

```ts
printifyProduct.tags = ["Women's Clothing", "Unisex", "DTG", "Cotton"]
listing.tags = []
canonicalType = "T-Shirt"
```

Shopify product tags:

```ts
["T-Shirt", "Printify", "Women's Clothing", "Unisex", "DTG", "Cotton"]
```

`productSet` has no `collections` field.

### Case B

Input:

```ts
printifyProduct.tags = []
listing.tags = []
canonicalType = "T-Shirt"
```

Shopify product tags:

```ts
["T-Shirt", "Printify"]
```

Smart Collections can still match if Shopify has rules such as `Product type is equal to T-Shirt` or `Product vendor is equal to Printify`.

### Case C

Input:

```ts
printifyProduct.tags = ["mockupai", "draft-preview"]
listing.tags = ["summer"]
canonicalType = "T-Shirt"
```

Shopify product tags:

```ts
["T-Shirt", "Printify", "summer"]
```

The internal Printify draft tags are not sent to Shopify.

## Implementation Notes

- Keep imports static and top-level.
- Prefer pure helpers for tag normalization so behavior is easy to test.
- Keep tag enrichment outside `retryWithBackoff()` to avoid delaying Shopify publish for optional metadata.
- Keep Shopify collection ownership out of this app. Collection membership belongs to Shopify Smart Collection rules configured by the customer.
