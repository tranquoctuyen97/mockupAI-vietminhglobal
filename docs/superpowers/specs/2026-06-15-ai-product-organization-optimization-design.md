# AI Product Organization Optimization Design

## Goal

Add a manual-edit-only Step 4 action that asks AI to optimize Shopify SEO tags and suggest broad manual collection names for the current draft.

The feature must not change the existing AI generate or regenerate flow. `Regenerate AI` continues to call the current content-generation endpoint only. AI generation does not call organization optimization, does not resolve Shopify collections, and does not mutate tags or collections beyond its existing listing content output.

## Non-Goals

- Do not add Shopify collection autocomplete in this phase.
- Do not create, update, or delete Shopify collections.
- Do not assign products to Smart Collections.
- Do not mutate the draft from the optimization API route.
- Do not make collection resolution a publish blocker.
- Do not remove the existing canonical product type fallback collection behavior.

## Current Context

Step 4 is implemented in `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`. It stores title, description, tags, alt text, and source in `WizardDraft.aiContent` JSON through the existing wizard draft store and PATCH flow.

The publish API creates `Listing` rows from `draft.aiContent` in `src/app/api/wizard/drafts/[id]/publish/route.ts`. The publish worker later reads the listing snapshot and calls `publishToShopify()` in `src/lib/publish/worker.ts`.

`src/lib/publish/shopify.ts` currently resolves a fallback Shopify Manual Collection from `PRODUCT_TYPE_COLLECTION_MAP` and only accepts matching collections where `ruleSet === null`.

There is an older, uncommitted spec that proposed omitting Shopify collections entirely so Smart Collections could own membership. This design supersedes that direction for this phase: optimized/manual collections are allowed, but only when they resolve to Shopify Manual Collections. Smart Collections remain untouched.

## Data Model

Step 4 will extend the existing AI content JSON shape:

```ts
type AiContent = {
  title: string;
  description: string;
  tags: string[];
  altText: string;
  collections?: string[];
  source?: "ai" | "manual";
};
```

No draft schema migration is needed because `WizardDraft.aiContent` is already JSON.

`Listing` gets a snapshot field:

```prisma
organizationCollections String[] @default([]) @map("organization_collections")
```

Use `String[]` because this project already uses Postgres-backed Prisma scalar lists for `Listing.tags`. If the target database or Prisma migration check rejects scalar lists in this environment, use a JSON field with the same application-level `string[]` contract instead.

The publish API copies `aiContent.collections ?? []` into this field when it creates a listing. The publish worker reads `listing.organizationCollections` first so retry and republish behavior stays tied to the listing data captured at publish time, not later draft edits.

## AI Optimize Route

Add:

```http
POST /api/wizard/drafts/:draftId/ai/optimize-product-organization
```

The route validates the session and draft ownership, resolves the selected design/store/template context, and calls the active tenant AI provider. It returns:

```ts
{
  tags: string[];
  collections: string[];
}
```

The route does not update `WizardDraft.aiContent`, does not write a listing, and does not call Shopify collection resolution. It is a pure suggestion endpoint from the UI's perspective.

The request body accepts the current manual form state:

- `title`
- `descriptionHtml`
- `productType`
- `canonicalProductType`
- `currentTags`
- `currentCollections`
- `selectedColors`
- `designContext`
- `niche`

The backend derives store, product, design, template, and color context from the draft owned by the current session. It must not trust `storeId` or ownership-related context from the client. Explicit request values can override only the editable content fields such as title, description, current tags, and current collections.

## Prompt

Use a separate prompt from the listing content generation prompt:

```text
Generate Shopify SEO tags and manual collection suggestions for this product.
Return strict JSON:
{
  "tags": string[],
  "collections": string[]
}

Rules:
- Max 15 tags.
- Tags must be short searchable Shopify tags.
- Collections should be broad store collection names, not too specific.
- Do not include duplicates.
- Do not include internal tags like mockupai or draft-preview.
- Prefer existing product type, audience, material, print method, niche, occasion.
- Prefer broad collection names such as T-Shirts, Hoodies, Sweatshirts, Patriotic, Gifts, New Arrivals, Men's Clothing, Women's Clothing.
```

Parsing must be strict enough to reject malformed output, but tolerant in cleanup: trim strings, drop empty strings, deduplicate case-insensitively, and cap tags at 15.

## AI Provider Boundary

Keep optimization separate from `ContentGenerator.generate()` to avoid changing existing generate/regenerate behavior. Add a small organization optimizer helper or provider-level function that can call the active provider with a custom prompt and parse `{ tags, collections }`.

This keeps listing generation, cache keys, and generated `aiContent` unchanged.

## Step 4 UI

The optimize button appears only when:

- the actual Step 4 state constant is `manual-edit`.
- AI config is available for the tenant.

If the UI can cheaply know AI is unavailable, hide the button. If the implementation uses a disabled state instead, the disabled title must be `Cần cấu hình AI để tối ưu tags & collections`.

Place the button next to the Tags label area:

```text
Tags (15/15) [✨ Tối ưu tags & collections]
```

While optimizing, disable the button and show `Đang tối ưu...`. On success, update local Step 4 form state and show:

```text
Đã tối ưu tags & collections. Bấm Lưu để áp dụng.
```

On error, preserve current tags and collections and show a short error toast.

The collections UI appears in manual edit mode near Tags. It uses chips and a simple text input:

- Existing or optimized collections display as removable chips.
- User can add a collection name manually.
- Input cleanup trims whitespace and drops empty values.
- Deduplication is case-insensitive.
- The saved collection list is capped at 10 values.

No Shopify autocomplete is required in this phase. Backend publish remains responsible for resolving text to real Shopify Manual Collection IDs.

## Collection Normalize Logic

Normalize collections in the Step 4 utility module and reuse the same helper before save:

```ts
function normalizeOrganizationCollections(values: unknown, max = 10): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(value);

    if (out.length >= max) break;
  }

  return out;
}
```

## Tag Merge Logic

When optimization succeeds, Step 4 merges AI tags before current tags:

```ts
function mergeOptimizedTags(aiTags: string[], currentTags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of [...aiTags, ...currentTags]) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(tag);

    if (out.length >= 15) break;
  }

  return out;
}
```

This helper must be exported from a small Step 4 utility module and unit tested as a pure function.

## Save And Next Behavior

The optimization API only returns suggestions. It does not persist them.

Step 4 updates local form state after success. The existing Save and Next flow persists `aiContent.collections` alongside `title`, `description`, `tags`, `altText`, and `source`.

Because the existing wizard store currently auto-syncs Step 4 content into the local draft store, Step 4 must stop calling `updateDraft()` from the generic `content` effect while `state === "manual-edit"`. Manual edit changes, including optimized tags and collections, remain in component state until the user presses Save or Next. Save/Next then writes `{ ...content, source: "manual" }` to the draft and flushes the existing draft PATCH flow.

Save and Next must both be tested for manual edit mode so title, description, tags, alt text, and collections survive navigation and publish listing creation.

## Publish Behavior

`publishToShopify()` accepts optional organization collections:

```ts
organizationCollections?: string[];
```

`createProductWithSet()` resolves collection IDs in this order:

1. Normalize and deduplicate `input.organizationCollections`.
2. Resolve those names against Shopify collections by exact title or handle.
3. Accept only collections where `ruleSet === null`.
4. If at least one Manual Collection resolves, set `productSetInput.collections` to those IDs.
5. If no optimized/manual Manual Collection resolves, fall back to `resolveCollectionIds(client, canonicalType)`.
6. If fallback also returns none, omit `collections`.

Collection resolution errors are non-fatal. They log a warning and fall back.

The Shopify GraphQL selection must query:

```graphql
ruleSet { appliedDisjunctively }
```

It must not rely on `ruleSet.id`.

## Resolver Details

Add this helper:

```ts
async function resolveManualCollectionIdsByTitlesOrHandles(
  client: ShopifyClient,
  values: string[],
): Promise<string[]>
```

Rules:

- Trim values.
- Drop empty values.
- Deduplicate case-insensitively.
- For each value, compare against exact title and handle.
- Derive a fallback handle with the existing handle normalizer.
- Accept only `ruleSet === null`.
- Preserve AI/user order for resolved IDs.
- Return `[]` on errors.

The existing fallback `resolveCollectionIds(client, canonicalType)` keeps using `PRODUCT_TYPE_COLLECTION_MAP`.

## Tag Publish Behavior

Tags keep the current publish merge behavior:

- Printify tags when available.
- Listing AI/manual tags.
- Default product-type tags from `buildProductTags()`.

This feature only changes the Step 4 manual optimization path and adds collection snapshot/resolution.

## Error Handling

Optimization failures:

- Do not clear current tags.
- Do not clear current collections.
- Show a short error toast.
- Leave the user in manual edit mode.

Publish collection resolution failures:

- Do not fail Shopify publish.
- Do not mark listing or publish job failed.
- Fall back to canonical product type collection resolution.
- If fallback also fails, omit collections.

Smart Collection matches:

- Must be ignored because `ruleSet !== null`.
- Must not be sent to `productSetInput.collections`.

## Tests

Add focused tests rather than broad whole-app tests:

- Step 4 helper test: `mergeOptimizedTags()` trims, drops empty tags, deduplicates case-insensitively, caps at 15, and keeps AI tags before current tags.
- Step 4 helper test: `normalizeOrganizationCollections()` trims, drops blanks, deduplicates case-insensitively, and caps at 10.
- Step 4 behavior/source test: optimize button is gated to manual edit mode and does not appear in ready mode.
- Step 4 Save/Next test: manual edit mode persists title, description, tags, alt text, and collections without losing any field.
- Optimize API test or source test: route returns `{ tags, collections }` and does not call `prisma.wizardDraft.update`.
- Optimize API test/source test: route derives store/context from the authenticated draft and does not trust client `storeId`.
- Publish API test/source test: listing creation copies `aiContent.collections` to `organizationCollections`.
- Shopify publish test: `publishToShopify()` prefers optimized/manual Manual Collection IDs over fallback.
- Shopify publish test: Smart Collections with non-null `ruleSet` are ignored.
- Shopify publish test: unresolved optimized collections fall back to `PRODUCT_TYPE_COLLECTION_MAP`.
- Regression test: `generate-content` route does not call `optimize-product-organization`.

## Acceptance Criteria Mapping

- Step 4 ready state does not show `✨ Tối ưu tags & collections`.
- `Regenerate AI` keeps current behavior and does not call the optimization route.
- Manual edit mode shows the optimize button only when AI config is available, or disables it with the configured tooltip.
- Clicking optimize updates form tags and collection chips only after the API succeeds.
- User still presses Save or Next to persist changes.
- Listing creation snapshots collections from `aiContent.collections`.
- Shopify publish prefers resolvable Manual Collections from `listing.organizationCollections`.
- Missing, empty, failing, or Smart Collection matches fall back to canonical product type collection mapping.
- No Smart Collection ID is sent in `productSetInput.collections`.
