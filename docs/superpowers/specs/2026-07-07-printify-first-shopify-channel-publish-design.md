# Printify-First Shopify Channel Publish Design

Date: 2026-07-07
Status: Approved for planning
Scope: New publishes only. Existing orphan Shopify/Printify products are not repaired in this phase.

## Problem

The current publish worker creates the Shopify product first, then creates or updates the Printify product. For Printify shops connected to Shopify, this can create a Shopify product without Printify-generated SKUs or fulfillment linkage. The observed ThreadsMuse failure produced:

- a Shopify product with 62 variants and empty SKUs
- a Printify product with enabled variants and real SKUs
- no saved `listing.printifyProductId`
- a `PARTIAL_FAILURE` listing after Printify create returned 500

This leaves Shopify line items unable to map to Printify fulfillment.

## Goals

- For Printify shops whose `salesChannel` is `shopify`, make Printify the source of truth for product publishing.
- Prevent new Shopify orphan products when Printify create/update/publish fails.
- Persist the full enabled variant matrix in `listing_variants`: color, size, Printify variant ID, SKU, Shopify variant ID.
- Keep all non-Printify-Shopify-channel stores on the current publish flow.
- Add enough verification to catch empty, duplicate, or mismatched SKUs before a listing is marked active.

## Non-Goals

- No automatic repair of existing orphan products or orders.
- No archive/delete/update behavior for already-published Shopify products.
- No broad rewrite of wizard, mockup generation, pricing, or store setup.
- No behavior change for stores without an active Printify Shopify sales channel.

## Documentation Evidence

Context7 Printify API docs confirm:

- `POST /v1/shops/{shop_id}/products/{product_id}/publish.json` publishes a product and may trigger connected sales channels.
- The publish body accepts boolean flags for `title`, `description`, `images`, `variants`, `tags`, `keyFeatures`, and `shipping_template`.
- Printify product responses include `variants[]` with fields such as `id`, `sku`, `price`, `cost`, `title`, `is_enabled`, and availability flags.
- Updating product variants requires sending all variants in the update payload.

## Publish Strategy

Add an explicit strategy resolver:

```text
if store.printifyShop.salesChannel == "shopify" and store.printifyShop.disconnected != true:
  use PRINTIFY_SHOPIFY_CHANNEL
else:
  use EXISTING_SHOPIFY_DIRECT
```

`PRINTIFY_SHOPIFY_CHANNEL` must not call Shopify `productSet` before Printify succeeds. `EXISTING_SHOPIFY_DIRECT` keeps the current worker behavior for stores not covered by this phase.

## Printify-First Flow

For `PRINTIFY_SHOPIFY_CHANNEL`:

1. Load listing, store, draft, draft design/pair, template, selected colors/sizes, pricing, placement, and mockup image inputs as today.
2. Resolve or build the final Printify product payload.
3. Reuse `draftDesign.printifyDraftProductId ?? draft.printifyDraftProductId` when present.
4. If no draft product exists, create a new Printify product.
5. If a draft product exists, update it with the final listing data.
6. GET the Printify product after create/update and extract the enabled variant matrix.
7. Validate enabled variants have non-empty, unique SKUs.
8. Call Printify `publishProduct()` with:

```json
{
  "title": true,
  "description": true,
  "images": true,
  "variants": true,
  "tags": true,
  "keyFeatures": true,
  "shipping_template": true
}
```

9. Poll/sync Shopify until the created Shopify product can be matched.
10. Persist listing IDs and full variant mapping.
11. Mark the listing active only after all post-publish invariants pass.

## Existing Flow

For every other store:

- Keep the current Shopify-direct path.
- Keep current Printify stage behavior.
- Do not require the new Printify-first SKU invariants.
- Do not alter Shopify `productSet` inventory behavior, Smart Collection ownership, or tag enrichment semantics.

## Variant Matrix Persistence

No schema change is required. `ListingVariant` already has the needed fields:

- `colorName`
- `colorHex`
- `size`
- `shopifyVariantId`
- `printifyVariantId`
- `sku`

In the Printify-first path, replace the existing color-only `ONE_SIZE` rows for the listing with the full enabled matrix after successful Printify product sync and Shopify match.

The mapping source is the Printify product response:

- `variants[].id` -> `printifyVariantId`
- `variants[].sku` -> `sku`
- parsed/options-derived color and size -> `colorName`, `size`
- matched Shopify variant -> `shopifyVariantId`

## Shopify Sync

After Printify `publish.json` succeeds, Shopify may lag behind Printify. The worker should poll instead of creating a Shopify fallback product.

Matching rules:

- Prefer SKU-set matching: enabled Printify SKUs must equal Shopify variant SKUs.
- Restrict candidates by store, title, and a recent publish window where practical.
- Reject candidates with missing, empty, partial, or extra SKU sets.
- Once matched, persist `listing.shopifyProductId`.

If no matching Shopify product is found before timeout, mark the listing `PARTIAL_FAILURE` with a reason such as:

```text
Printify published but Shopify sync was not confirmed
```

Do not create a replacement Shopify product in this case.

## Retry And Reconciliation

Printify 5xx can happen after a product was created. Retrying create blindly can create duplicate `Copy of ...` products.

Before retrying a create after a transient Printify failure:

- check whether a recent candidate Printify product exists for the listing/draft
- prefer an exact draft product ID if already saved
- otherwise search/list recent products by safe markers such as title and blueprint/provider
- if a valid candidate is found, continue with update/publish instead of creating again

Logs must include only safe identifiers:

- `listingId`
- `storeId`
- `printifyProductId`
- `shopifyProductId`
- stage
- `error.message`

Logs must not include credentials, tokens, raw request payloads, or full client objects.

## Failure Behavior

For `PRINTIFY_SHOPIFY_CHANNEL`:

- Payload build failure: mark failed before Shopify exists.
- Printify create/update failure: mark failed before Shopify exists.
- Missing SKU from enabled Printify variants: mark failed before publish.
- Duplicate SKU: mark failed before publish.
- Printify `publish.json` non-2xx/error: mark `FAILED`; do not call Shopify `productSet`.
- Printify `publish.json` success but Shopify sync timeout: mark `PARTIAL_FAILURE`; do not create Shopify product.
- DB persistence failure after sync: leave listing non-active and log safe IDs for manual inspection.

## Post-Publish Invariants

A Printify-first listing can be marked `ACTIVE` only when:

- `listing.printifyProductId` is set
- `listing.shopifyProductId` is set
- enabled Printify SKU count is greater than zero
- Shopify variant SKU set equals enabled Printify SKU set
- `listing_variants` count equals enabled Printify variant count
- every `listing_variants` row has `sku`, `printifyVariantId`, and `shopifyVariantId`

## Tests

Add focused tests for:

- strategy resolver chooses Printify-first only for active `salesChannel = "shopify"` shops
- non-Shopify-channel stores keep existing Shopify-direct behavior
- Printify product matrix extraction rejects missing SKU
- Printify product matrix extraction rejects duplicate SKU
- Shopify sync matcher rejects empty, partial, or extra SKU sets
- Printify-first worker path does not call Shopify `productSet`
- Printify-first worker path persists full `Color + Size` rows
- transient Printify create error can reconcile to an existing candidate instead of creating a duplicate

## Rollout

- Gate Printify-first behavior behind a runtime kill switch.
- Default the strategy on for stores with active Printify Shopify sales channels.
- Deploy affects new publishes only.
- First smoke test should use ThreadsMuse:
  1. publish one new product
  2. confirm Printify product exists
  3. confirm Printify publish creates the Shopify product
  4. confirm all Shopify variants have SKUs
  5. confirm DB mapping has full color/size/SKU rows
  6. confirm an order line is fulfillable by Printify

## Open Decisions

No open product decisions remain for phase A. The accepted scope is:

- Option 2: Printify-first for `PrintifyShop.salesChannel = "shopify"`
- all other stores keep current behavior
- reuse draft Printify product when available
- no repair of old orphan products in this phase
- write spec only; no commit from the agent
