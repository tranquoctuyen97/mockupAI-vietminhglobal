# Printify-First Shopify Channel Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route new publishes for active Printify Shopify-channel stores through Printify first, then sync Shopify IDs/SKUs back into the listing.

**Architecture:** Add small pure helpers for strategy selection, Printify enabled-variant extraction, and Shopify SKU-set matching. Wire a new Printify-first branch into `runPublishWorker` only when `store.printifyShop.salesChannel === "shopify"` and the shop is not disconnected; every other store keeps the existing Shopify-direct path. Persist full `Color + Size + SKU` rows only after Printify publish and Shopify sync pass the invariants.

**Tech Stack:** Next.js App Router route handlers, Prisma/PostgreSQL, Printify REST API, Shopify Admin GraphQL via existing `ShopifyClient.graphql`, Node built-in test runner through `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-07-07-printify-first-shopify-channel-publish-design.md`

**User constraint:** Do not `git add` or commit. The commit steps normally required by this skill are replaced with explicit no-commit checkpoints.

---

## File Structure

- Create `src/lib/publish/strategy.ts`
  - Owns the publish strategy decision.
  - Has no Prisma, network, or worker dependencies.

- Create `src/lib/publish/strategy.test.ts`
  - Tests active Shopify-channel, disconnected Shopify-channel, non-Shopify-channel, and missing Printify shop.

- Create `src/lib/printify/product-matrix.ts`
  - Extracts enabled Printify product variants into full matrix rows.
  - Validates non-empty unique SKUs for enabled variants.

- Create `src/lib/printify/product-matrix.test.ts`
  - Tests option parsing, missing SKU rejection, duplicate SKU rejection, and disabled variant filtering.

- Create `src/lib/publish/shopify-sync.ts`
  - Contains pure SKU-set matching helpers and Shopify GraphQL polling helpers.
  - Uses `Pick<ShopifyClient, "graphql">` to keep it easy to test.

- Create `src/lib/publish/shopify-sync.test.ts`
  - Tests matching, missing/partial/extra SKU rejection, and polling timeout behavior.

- Modify `src/lib/publish/worker.ts`
  - Include `store.printifyShop` in the store load.
  - Resolve strategy.
  - Add a Printify-first branch before current Shopify stage.
  - Keep current Shopify-direct flow unchanged for all other stores.
  - Reuse existing Printify payload-building behavior where possible.

- Modify `src/lib/publish/worker.test.ts`
  - Add source-level and pure-helper tests proving Printify-first does not call Shopify `productSet` before Printify.
  - Keep existing tests intact.

- Modify `src/app/api/listings/[id]/retry-printify/route.ts`
  - For Printify Shopify-channel listings, retry the full publish worker instead of only `runPrintifyStage`, because Shopify sync is now part of that strategy.

---

### Task 1: Publish Strategy Helper

**Files:**
- Create: `src/lib/publish/strategy.ts`
- Create: `src/lib/publish/strategy.test.ts`

- [ ] **Step 1: Write the failing strategy tests**

Create `src/lib/publish/strategy.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePublishStrategy } from "./strategy";

describe("resolvePublishStrategy", () => {
  it("uses Printify-first for active Printify Shopify sales channels", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: "shopify", disconnected: false },
      }),
      "PRINTIFY_SHOPIFY_CHANNEL",
    );
  });

  it("normalizes sales channel casing and whitespace", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: " Shopify ", disconnected: false },
      }),
      "PRINTIFY_SHOPIFY_CHANNEL",
    );
  });

  it("keeps the existing path for disconnected Printify shops", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: "shopify", disconnected: true },
      }),
      "EXISTING_SHOPIFY_DIRECT",
    );
  });

  it("keeps the existing path for non-Shopify Printify sales channels", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: "custom", disconnected: false },
      }),
      "EXISTING_SHOPIFY_DIRECT",
    );
  });

  it("keeps the existing path when the store has no Printify shop", () => {
    assert.equal(resolvePublishStrategy({ printifyShop: null }), "EXISTING_SHOPIFY_DIRECT");
  });
});
```

- [ ] **Step 2: Run the strategy test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/strategy.test.ts
```

Expected: FAIL because `src/lib/publish/strategy.ts` does not exist.

- [ ] **Step 3: Add the minimal strategy helper**

Create `src/lib/publish/strategy.ts`:

```ts
export type PublishStrategy = "PRINTIFY_SHOPIFY_CHANNEL" | "EXISTING_SHOPIFY_DIRECT";

export type PublishStrategyStore = {
  printifyShop?: {
    salesChannel?: string | null;
    disconnected?: boolean | null;
  } | null;
};

export function resolvePublishStrategy(store: PublishStrategyStore): PublishStrategy {
  const salesChannel = store.printifyShop?.salesChannel?.trim().toLowerCase();
  if (salesChannel === "shopify" && store.printifyShop?.disconnected !== true) {
    return "PRINTIFY_SHOPIFY_CHANNEL";
  }
  return "EXISTING_SHOPIFY_DIRECT";
}
```

- [ ] **Step 4: Run the strategy test and verify it passes**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/strategy.test.ts
```

Expected: PASS.

- [ ] **Step 5: No-commit checkpoint**

Run:

```bash
git status --short src/lib/publish/strategy.ts src/lib/publish/strategy.test.ts
```

Expected: both files appear as untracked or modified. Do not run `git add` or `git commit`.

---

### Task 2: Printify Enabled Variant Matrix

**Files:**
- Create: `src/lib/printify/product-matrix.ts`
- Create: `src/lib/printify/product-matrix.test.ts`

- [ ] **Step 1: Write failing matrix extraction tests**

Create `src/lib/printify/product-matrix.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrintifyProductResponse } from "./client";
import {
  PrintifyVariantMatrixError,
  extractEnabledPrintifyVariantMatrix,
} from "./product-matrix";

const product = (overrides: Partial<PrintifyProductResponse> = {}): PrintifyProductResponse => ({
  id: "printify-product-1",
  title: "Test Product",
  blueprint_id: 12,
  print_provider_id: 39,
  options: [
    {
      name: "Colors",
      type: "color",
      values: [
        { id: 10, title: "Black", colors: ["#111111"] },
        { id: 11, title: "White", colors: ["#ffffff"] },
      ],
    },
    {
      name: "Sizes",
      type: "size",
      values: [
        { id: 20, title: "S" },
        { id: 21, title: "M" },
      ],
    },
  ],
  variants: [
    {
      id: 101,
      title: "Black / S",
      sku: "BLACK-S",
      price: 3199,
      is_enabled: true,
      options: [10, 20],
    },
    {
      id: 102,
      title: "Black / M",
      sku: "BLACK-M",
      price: 3299,
      is_enabled: true,
      options: [10, 21],
    },
    {
      id: 103,
      title: "White / S",
      sku: "WHITE-S",
      price: 3199,
      is_enabled: false,
      options: [11, 20],
    },
  ],
  ...overrides,
});

describe("extractEnabledPrintifyVariantMatrix", () => {
  it("returns enabled variants with color, size, sku, price, and Printify variant id", () => {
    assert.deepEqual(extractEnabledPrintifyVariantMatrix(product()), [
      {
        printifyVariantId: 101,
        sku: "BLACK-S",
        title: "Black / S",
        colorName: "Black",
        colorHex: "#111111",
        size: "S",
        priceCents: 3199,
      },
      {
        printifyVariantId: 102,
        sku: "BLACK-M",
        title: "Black / M",
        colorName: "Black",
        colorHex: "#111111",
        size: "M",
        priceCents: 3299,
      },
    ]);
  });

  it("falls back to parsing variant title when option IDs are missing", () => {
    const rows = extractEnabledPrintifyVariantMatrix(
      product({
        options: [],
        variants: [
          {
            id: 201,
            title: "Heather Navy / XL",
            sku: "NAVY-XL",
            price: 3399,
            is_enabled: true,
            options: [],
          },
        ],
      }),
    );
    assert.equal(rows[0].colorName, "Heather Navy");
    assert.equal(rows[0].size, "XL");
  });

  it("throws when an enabled variant has no SKU", () => {
    assert.throws(
      () =>
        extractEnabledPrintifyVariantMatrix(
          product({
            variants: [
              {
                id: 101,
                title: "Black / S",
                sku: "",
                price: 3199,
                is_enabled: true,
                options: [10, 20],
              },
            ],
          }),
        ),
      /Missing SKU for enabled Printify variant 101/,
    );
  });

  it("throws on duplicate enabled SKUs", () => {
    assert.throws(
      () =>
        extractEnabledPrintifyVariantMatrix(
          product({
            variants: [
              {
                id: 101,
                title: "Black / S",
                sku: "DUP",
                price: 3199,
                is_enabled: true,
                options: [10, 20],
              },
              {
                id: 102,
                title: "Black / M",
                sku: "DUP",
                price: 3299,
                is_enabled: true,
                options: [10, 21],
              },
            ],
          }),
        ),
      /Duplicate Printify SKU/,
    );
  });

  it("throws when no enabled variants remain", () => {
    assert.throws(
      () => extractEnabledPrintifyVariantMatrix(product({ variants: [] })),
      PrintifyVariantMatrixError,
    );
  });
});
```

- [ ] **Step 2: Run the matrix test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/product-matrix.test.ts
```

Expected: FAIL because `product-matrix.ts` does not exist.

- [ ] **Step 3: Add the matrix helper**

Create `src/lib/printify/product-matrix.ts`:

```ts
import type {
  PrintifyProductOption,
  PrintifyProductOptionValue,
  PrintifyProductResponse,
} from "./client";

export type EnabledPrintifyVariantMatrixRow = {
  printifyVariantId: number;
  sku: string;
  title: string;
  colorName: string;
  colorHex: string | null;
  size: string;
  priceCents: number;
};

type OptionValueWithType = PrintifyProductOptionValue & { type: string };

export class PrintifyVariantMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintifyVariantMatrixError";
  }
}

export function extractEnabledPrintifyVariantMatrix(
  product: PrintifyProductResponse,
): EnabledPrintifyVariantMatrixRow[] {
  const optionLookup = buildOptionLookup(product.options ?? []);
  const rows = (product.variants ?? [])
    .filter((variant) => variant.is_enabled === true)
    .map((variant) => {
      const sku = variant.sku?.trim() ?? "";
      if (!sku) {
        throw new PrintifyVariantMatrixError(
          `Missing SKU for enabled Printify variant ${variant.id}`,
        );
      }

      const optionValues = (variant.options ?? [])
        .map((id) => optionLookup.get(id))
        .filter((value): value is OptionValueWithType => Boolean(value));
      const colorOption = optionValues.find((value) => value.type === "color");
      const sizeOption = optionValues.find((value) => value.type === "size");
      const titleParts = splitVariantTitle(variant.title);

      return {
        printifyVariantId: variant.id,
        sku,
        title: variant.title ?? "",
        colorName: colorOption?.title ?? titleParts.colorName ?? "Unknown",
        colorHex: colorOption?.colors?.[0] ?? null,
        size: sizeOption?.title ?? titleParts.size ?? "ONE_SIZE",
        priceCents: variant.price ?? 0,
      };
    });

  if (rows.length === 0) {
    throw new PrintifyVariantMatrixError(`No enabled Printify variants for product ${product.id}`);
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.sku.toLowerCase();
    if (seen.has(key)) {
      throw new PrintifyVariantMatrixError(`Duplicate Printify SKU: ${row.sku}`);
    }
    seen.add(key);
  }

  return rows;
}

function buildOptionLookup(options: PrintifyProductOption[]): Map<number, OptionValueWithType> {
  const lookup = new Map<number, OptionValueWithType>();
  for (const option of options) {
    for (const value of option.values ?? []) {
      lookup.set(value.id, { ...value, type: option.type });
    }
  }
  return lookup;
}

function splitVariantTitle(title: string | undefined): { colorName: string | null; size: string | null } {
  if (!title) return { colorName: null, size: null };
  const parts = title
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { colorName: null, size: null };
  if (parts.length === 1) return { colorName: parts[0], size: "ONE_SIZE" };
  return {
    colorName: parts[0],
    size: parts[parts.length - 1],
  };
}
```

- [ ] **Step 4: Run the matrix test and verify it passes**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/product-matrix.test.ts
```

Expected: PASS.

- [ ] **Step 5: No-commit checkpoint**

Run:

```bash
git status --short src/lib/printify/product-matrix.ts src/lib/printify/product-matrix.test.ts
```

Expected: both files appear as untracked or modified. Do not run `git add` or `git commit`.

---

### Task 3: Shopify SKU-Set Matching

**Files:**
- Create: `src/lib/publish/shopify-sync.ts`
- Create: `src/lib/publish/shopify-sync.test.ts`

- [ ] **Step 1: Write failing pure matcher tests**

Create `src/lib/publish/shopify-sync.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EnabledPrintifyVariantMatrixRow } from "@/lib/printify/product-matrix";
import {
  ShopifySyncTimeoutError,
  selectShopifyProductCandidate,
  waitForShopifyProductSync,
} from "./shopify-sync";

const printifyRows: EnabledPrintifyVariantMatrixRow[] = [
  {
    printifyVariantId: 101,
    sku: "BLACK-S",
    title: "Black / S",
    colorName: "Black",
    colorHex: "#111",
    size: "S",
    priceCents: 3199,
  },
  {
    printifyVariantId: 102,
    sku: "BLACK-M",
    title: "Black / M",
    colorName: "Black",
    colorHex: "#111",
    size: "M",
    priceCents: 3299,
  },
];

describe("selectShopifyProductCandidate", () => {
  it("matches one Shopify product by exact SKU set", () => {
    const match = selectShopifyProductCandidate(printifyRows, [
      {
        id: "gid://shopify/ProductVariant/1",
        sku: "BLACK-S",
        selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }],
        product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
      },
      {
        id: "gid://shopify/ProductVariant/2",
        sku: "BLACK-M",
        selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }],
        product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
      },
    ]);

    assert.equal(match?.shopifyProductId, "gid://shopify/Product/10");
    assert.deepEqual(match?.variantsBySku.get("BLACK-S")?.shopifyVariantId, "gid://shopify/ProductVariant/1");
  });

  it("rejects products with missing SKU", () => {
    assert.equal(
      selectShopifyProductCandidate(printifyRows, [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "",
          selectedOptions: [],
          product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
        },
      ]),
      null,
    );
  });

  it("rejects partial or extra SKU sets", () => {
    assert.equal(
      selectShopifyProductCandidate(printifyRows, [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "BLACK-S",
          selectedOptions: [],
          product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
        },
      ]),
      null,
    );

    assert.equal(
      selectShopifyProductCandidate(printifyRows, [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "BLACK-S",
          selectedOptions: [],
          product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
        },
        {
          id: "gid://shopify/ProductVariant/2",
          sku: "BLACK-M",
          selectedOptions: [],
          product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
        },
        {
          id: "gid://shopify/ProductVariant/3",
          sku: "EXTRA",
          selectedOptions: [],
          product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:00Z" },
        },
      ]),
      null,
    );
  });
});

describe("waitForShopifyProductSync", () => {
  it("polls until a matching product appears", async () => {
    let calls = 0;
    const result = await waitForShopifyProductSync({
      printifyRows,
      updatedAfterIso: "2026-07-07T00:00:00Z",
      timeoutMs: 100,
      intervalMs: 1,
      now: () => calls,
      sleep: async () => {
        calls += 10;
      },
      fetchCandidates: async () => {
        calls += 1;
        return calls < 2
          ? []
          : [
              {
                id: "gid://shopify/ProductVariant/1",
                sku: "BLACK-S",
                selectedOptions: [],
                product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:01Z" },
              },
              {
                id: "gid://shopify/ProductVariant/2",
                sku: "BLACK-M",
                selectedOptions: [],
                product: { id: "gid://shopify/Product/10", title: "Product", updatedAt: "2026-07-07T00:00:01Z" },
              },
            ];
      },
    });

    assert.equal(result.shopifyProductId, "gid://shopify/Product/10");
  });

  it("throws a timeout when no matching product appears", async () => {
    let currentTime = 0;
    await assert.rejects(
      waitForShopifyProductSync({
        printifyRows,
        updatedAfterIso: "2026-07-07T00:00:00Z",
        timeoutMs: 5,
        intervalMs: 2,
        now: () => currentTime,
        sleep: async (ms) => {
          currentTime += ms;
        },
        fetchCandidates: async () => [],
      }),
      ShopifySyncTimeoutError,
    );
  });
});
```

- [ ] **Step 2: Run the sync matcher test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify-sync.test.ts
```

Expected: FAIL because `shopify-sync.ts` does not exist.

- [ ] **Step 3: Add pure matcher and polling helpers**

Create `src/lib/publish/shopify-sync.ts`:

```ts
import type { EnabledPrintifyVariantMatrixRow } from "@/lib/printify/product-matrix";
import type { ShopifyClient } from "@/lib/shopify/client";

export type ShopifyVariantCandidate = {
  id: string;
  sku: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  product: {
    id: string;
    title: string;
    handle?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
};

export type ShopifySyncMatch = {
  shopifyProductId: string;
  variantsBySku: Map<
    string,
    {
      shopifyVariantId: string;
      selectedOptions: Array<{ name: string; value: string }>;
    }
  >;
};

export class ShopifySyncTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out waiting ${timeoutMs}ms for Shopify product sync`);
    this.name = "ShopifySyncTimeoutError";
  }
}

export function selectShopifyProductCandidate(
  printifyRows: EnabledPrintifyVariantMatrixRow[],
  candidates: ShopifyVariantCandidate[],
): ShopifySyncMatch | null {
  const expectedSkus = new Set(printifyRows.map((row) => row.sku.trim()).filter(Boolean));
  if (expectedSkus.size === 0) return null;

  const byProduct = new Map<string, ShopifyVariantCandidate[]>();
  for (const candidate of candidates) {
    const productId = candidate.product.id;
    const group = byProduct.get(productId) ?? [];
    group.push(candidate);
    byProduct.set(productId, group);
  }

  const sortedGroups = [...byProduct.values()].sort((a, b) => {
    const au = a[0]?.product.updatedAt ?? "";
    const bu = b[0]?.product.updatedAt ?? "";
    return bu.localeCompare(au);
  });

  for (const group of sortedGroups) {
    const variantsBySku = new Map<string, { shopifyVariantId: string; selectedOptions: Array<{ name: string; value: string }> }>();
    let invalid = false;

    for (const variant of group) {
      const sku = variant.sku?.trim();
      if (!sku) {
        invalid = true;
        break;
      }
      variantsBySku.set(sku, {
        shopifyVariantId: variant.id,
        selectedOptions: variant.selectedOptions,
      });
    }

    if (invalid) continue;
    if (!sameSkuSet(expectedSkus, new Set(variantsBySku.keys()))) continue;

    return {
      shopifyProductId: group[0].product.id,
      variantsBySku,
    };
  }

  return null;
}

export async function fetchRecentShopifyVariantCandidates(input: {
  client: Pick<ShopifyClient, "graphql">;
  updatedAfterIso: string;
  title?: string;
  maxPages?: number;
}): Promise<ShopifyVariantCandidate[]> {
  const queryText = [`updated_at:>${input.updatedAfterIso}`];
  const titleFilter = input.title?.trim().toLowerCase() ?? "";

  const query = `
    query ProductVariantsForPrintifySync($first: Int!, $after: String, $query: String!) {
      productVariants(first: $first, after: $after, query: $query) {
        nodes {
          id
          sku
          selectedOptions { name value }
          product {
            id
            title
            handle
            createdAt
            updatedAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const out: ShopifyVariantCandidate[] = [];
  let after: string | null = null;
  const maxPages = input.maxPages ?? 5;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await input.client.graphql<{
      productVariants: {
        nodes: ShopifyVariantCandidate[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(query, {
      first: 100,
      after,
      query: queryText.join(" "),
    });

    out.push(
      ...data.productVariants.nodes.filter((node) => {
        if (!titleFilter) return true;
        return node.product.title.trim().toLowerCase() === titleFilter;
      }),
    );
    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
    if (!after) break;
  }

  return out;
}

export async function waitForShopifyProductSync(input: {
  printifyRows: EnabledPrintifyVariantMatrixRow[];
  updatedAfterIso: string;
  timeoutMs: number;
  intervalMs: number;
  title?: string;
  client?: Pick<ShopifyClient, "graphql">;
  fetchCandidates?: () => Promise<ShopifyVariantCandidate[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ShopifySyncMatch> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();

  while (now() - startedAt <= input.timeoutMs) {
    const candidates = input.fetchCandidates
      ? await input.fetchCandidates()
      : await fetchRecentShopifyVariantCandidates({
          client: requiredClient(input.client),
          updatedAfterIso: input.updatedAfterIso,
          title: input.title,
        });
    const match = selectShopifyProductCandidate(input.printifyRows, candidates);
    if (match) return match;
    await sleep(input.intervalMs);
  }

  throw new ShopifySyncTimeoutError(input.timeoutMs);
}

function sameSkuSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function requiredClient(client: Pick<ShopifyClient, "graphql"> | undefined): Pick<ShopifyClient, "graphql"> {
  if (!client) throw new Error("Shopify client is required when fetchCandidates is not provided");
  return client;
}

```

- [ ] **Step 4: Run the sync matcher test and verify it passes**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify-sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: No-commit checkpoint**

Run:

```bash
git status --short src/lib/publish/shopify-sync.ts src/lib/publish/shopify-sync.test.ts
```

Expected: both files appear as untracked or modified. Do not run `git add` or `git commit`.

---

### Task 4: Worker Branch Selection

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Write failing source-level tests for branch selection**

Append to `src/lib/publish/worker.test.ts`:

```ts
describe("Printify Shopify-channel publish branch", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

  it("loads the store Printify shop for strategy resolution", () => {
    assert.match(source, /include:\s*\{\s*printifyShop:\s*true\s*\}/);
  });

  it("resolves publish strategy before the Shopify productSet stage", () => {
    const strategyIndex = source.indexOf("resolvePublishStrategy");
    const shopifyStageIndex = source.indexOf("Stage 1: Shopify");
    assert.ok(strategyIndex > -1, "resolvePublishStrategy should be used in worker");
    assert.ok(shopifyStageIndex > -1, "Shopify stage marker should remain present");
    assert.ok(strategyIndex < shopifyStageIndex, "strategy must be resolved before Shopify stage");
  });

  it("returns from Printify-first branch before publishToShopify can run", () => {
    assert.match(source, /PRINTIFY_SHOPIFY_CHANNEL/);
    assert.match(source, /runPrintifyShopifyChannelPublish/);
  });
});
```

- [ ] **Step 2: Run worker tests and verify the new assertions fail**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because worker does not include `printifyShop`, does not call `resolvePublishStrategy`, and does not have `runPrintifyShopifyChannelPublish`.

- [ ] **Step 3: Add imports in `worker.ts`**

Modify the imports near the top of `src/lib/publish/worker.ts`:

```ts
import { classifyColorHex, resolveColorGroups } from "@/lib/designs/color-classifier";
import { extractEnabledPrintifyVariantMatrix } from "@/lib/printify/product-matrix";
import { resolvePublishStrategy } from "@/lib/publish/strategy";
import { waitForShopifyProductSync } from "@/lib/publish/shopify-sync";
```

- [ ] **Step 4: Load `printifyShop` on the store query**

Replace the store load in `runPublishWorker`:

```ts
const store = await prisma.store.findUnique({
  where: { id: listing.storeId! },
});
```

with:

```ts
const store = await prisma.store.findUnique({
  where: { id: listing.storeId! },
  include: { printifyShop: true },
});
```

- [ ] **Step 5: Add the strategy branch before the existing Shopify stage**

Insert this block after mockup media validation and before the `// ─── Stage 1: Shopify` comment:

```ts
    const publishStrategy = resolvePublishStrategy(store);
    if (publishStrategy === "PRINTIFY_SHOPIFY_CHANNEL") {
      await runPrintifyShopifyChannelPublish({
        listingId,
        listing,
        draft,
        store,
        shopifyAccessToken,
        storage,
        isDryRun,
        publishChannelId,
        draftChannelId,
        emitEvent,
      });
      return;
    }
```

- [ ] **Step 6: Add a temporary function stub that fails safely**

Add this function below `runPrintifyStage` in `src/lib/publish/worker.ts`:

```ts
async function runPrintifyShopifyChannelPublish(input: {
  listingId: string;
  listing: any;
  draft: any;
  store: any;
  shopifyAccessToken: string;
  storage: any;
  isDryRun: boolean;
  publishChannelId: string;
  draftChannelId: string;
  emitEvent: (type: string, data?: Record<string, unknown>) => void;
}): Promise<void> {
  await prisma.listing.update({
    where: { id: input.listingId },
    data: { status: "FAILED" },
  });
  input.emitEvent("publish.failed", {
    stage: "PRINTIFY",
    error: "Printify Shopify-channel publish branch is not implemented",
  });
}
```

This stub is intentionally safe: it does not create Shopify products.

- [ ] **Step 7: Run worker tests and verify the source-level branch checks pass**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS for source-level branch checks. Existing tests should remain green.

- [ ] **Step 8: No-commit checkpoint**

Run:

```bash
git status --short src/lib/publish/worker.ts src/lib/publish/worker.test.ts
```

Expected: files are modified. Do not run `git add` or `git commit`.

---

### Task 5: Printify-First Orchestration

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Add source-level tests for the branch invariants**

Append to `src/lib/publish/worker.test.ts`:

```ts
describe("runPrintifyShopifyChannelPublish invariants", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

  it("publishes through Printify publishProduct before Shopify sync", () => {
    const publishIndex = source.indexOf(".publishProduct(");
    const syncIndex = source.indexOf("waitForShopifyProductSync");
    assert.ok(publishIndex > -1, "Printify publishProduct should be called");
    assert.ok(syncIndex > -1, "Shopify sync should be called");
    assert.ok(publishIndex < syncIndex, "Printify publish must happen before Shopify sync");
  });

  it("extracts enabled Printify matrix and persists listing variants", () => {
    assert.match(source, /extractEnabledPrintifyVariantMatrix/);
    assert.match(source, /listingVariant\.deleteMany/);
    assert.match(source, /listingVariant\.createMany/);
  });

  it("marks Shopify sync timeout as partial failure without Shopify productSet fallback", () => {
    assert.match(source, /Printify published but Shopify sync was not confirmed/);
    assert.doesNotMatch(source, /catch[\s\S]{0,400}publishToShopify/);
  });
});
```

- [ ] **Step 2: Run worker tests and verify the new invariant tests fail**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because the branch stub does not call Printify publish, Shopify sync, or persist variants.

- [ ] **Step 3: Replace the safe stub with the real Printify-first orchestration**

Replace the `runPrintifyShopifyChannelPublish` stub with:

```ts
async function runPrintifyShopifyChannelPublish(input: {
  listingId: string;
  listing: any;
  draft: any;
  store: any;
  shopifyAccessToken: string;
  storage: any;
  isDryRun: boolean;
  publishChannelId: string;
  draftChannelId: string;
  emitEvent: (type: string, data?: Record<string, unknown>) => void;
}): Promise<void> {
  const { listingId, listing, draft, store, shopifyAccessToken, storage, isDryRun, emitEvent } = input;
  const printifyJob = listing.publishJobs.find((job: any) => job.stage === "PRINTIFY");
  const shopifyJob = listing.publishJobs.find((job: any) => job.stage === "SHOPIFY");

  if (!printifyJob) throw new Error("Printify publish job not found");
  if (!shopifyJob) throw new Error("Shopify publish job not found");

  await prisma.publishJob.update({
    where: { id: printifyJob.id },
    data: { status: "RUNNING" },
  });
  await prisma.publishJob.update({
    where: { id: shopifyJob.id },
    data: { status: "PENDING", lastError: "Waiting for Printify Shopify-channel sync" },
  });

  emitEvent("publish.printify.start", { stage: "PRINTIFY" });

  if (isDryRun) {
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        printifyProductId: `dry-run-printify-${Date.now()}`,
        shopifyProductId: `gid://shopify/Product/dry-run-${Date.now()}`,
        status: "ACTIVE",
        publishedAt: new Date(),
      },
    });
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
    });
    emitEvent("publish.complete", { status: "ACTIVE" });
    return;
  }

  const startedAtIso = new Date().toISOString();
  const { client: printifyClient, externalShopId } = await getClientForStore(store.id);
  const draftDesign = listing.wizardDraftDesignId
    ? (draft.draftDesigns?.find((entry: any) => entry.id === listing.wizardDraftDesignId) ?? null)
    : null;
  const productId =
    draftDesign?.printifyDraftProductId ?? draft.printifyDraftProductId ?? null;

  const publishInput = await resolvePrintifyProductPublishInput({
    listing,
    draft,
    draftDesign,
    store,
    storage,
    printifyClient,
    externalShopId,
    productId,
  });

  let productIdForAttempt = publishInput.productId;
  const printifyProductResult = await retryWithBackoff(
    async () => {
      try {
        return await createOrUpdatePrintifyProduct({
          client: printifyClient,
          shopId: externalShopId,
          productId: productIdForAttempt,
          blueprintId: publishInput.blueprintId,
          printProviderId: publishInput.printProviderId,
          variantIds: publishInput.variantIds,
          variants: publishInput.variants,
          imageId: publishInput.imageId,
          imageGroups: publishInput.imageGroups,
          placementData: publishInput.placementData,
          title: listing.title,
          description: listing.descriptionHtml,
          tags: listing.tags,
        });
      } catch (err) {
        if (isTransientPrintifyCreateError(err) && !productIdForAttempt) {
          const candidate = await findRecentPrintifyProductCandidate({
            client: printifyClient,
            shopId: externalShopId,
            title: listing.title,
            blueprintId: publishInput.blueprintId,
            printProviderId: publishInput.printProviderId,
          });
          if (candidate) {
            productIdForAttempt = candidate.id;
            return createOrUpdatePrintifyProduct({
              client: printifyClient,
              shopId: externalShopId,
              productId: candidate.id,
              blueprintId: publishInput.blueprintId,
              printProviderId: publishInput.printProviderId,
              variantIds: publishInput.variantIds,
              variants: publishInput.variants,
              imageId: publishInput.imageId,
              imageGroups: publishInput.imageGroups,
              placementData: publishInput.placementData,
              title: listing.title,
              description: listing.descriptionHtml,
              tags: listing.tags,
            });
          }
        }
        throw err;
      }
    },
    printifyJob.id,
    "PRINTIFY",
  );

  if (!printifyProductResult) {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "FAILED" },
    });
    emitEvent("publish.failed", { stage: "PRINTIFY", error: "Printify product create/update failed" });
    return;
  }

  let printifyRows: ReturnType<typeof extractEnabledPrintifyVariantMatrix>;
  try {
    const printifyProduct = await printifyClient.getProduct(externalShopId, printifyProductResult.productId);
    printifyRows = extractEnabledPrintifyVariantMatrix(printifyProduct);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to read Printify product variants";
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "FAILED", lastError: error, completedAt: new Date() },
    });
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "FAILED" },
    });
    emitEvent("publish.failed", { stage: "PRINTIFY", error });
    return;
  }

  try {
    await printifyClient.publishProduct(externalShopId, printifyProductResult.productId, {
      title: true,
      description: true,
      images: true,
      variants: true,
      tags: true,
      keyFeatures: true,
      shipping_template: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Printify publish failed";
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "FAILED", lastError: error, completedAt: new Date() },
    });
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "FAILED" },
    });
    emitEvent("publish.failed", { stage: "PRINTIFY", error });
    return;
  }

  await prisma.listing.update({
    where: { id: listingId },
    data: { printifyProductId: printifyProductResult.productId },
  });
  await prisma.publishJob.update({
    where: { id: printifyJob.id },
    data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
  });
  emitEvent("publish.printify.done", { printifyProductId: printifyProductResult.productId });

  emitEvent("publish.shopify.start", { stage: "SHOPIFY" });
  await prisma.publishJob.update({
    where: { id: shopifyJob.id },
    data: { status: "RUNNING", lastError: null },
  });

  let syncMatch;
  try {
    const shopifyClient = new ShopifyClient(store.shopifyDomain!, shopifyAccessToken);
    syncMatch = await waitForShopifyProductSync({
      client: shopifyClient,
      printifyRows,
      updatedAfterIso: startedAtIso,
      title: listing.title,
      timeoutMs: 120_000,
      intervalMs: 5_000,
    });
  } catch (err) {
    const message = "Printify published but Shopify sync was not confirmed";
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: {
        status: "FAILED",
        lastError: err instanceof Error ? `${message}: ${err.message}` : message,
        completedAt: new Date(),
      },
    });
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "PARTIAL_FAILURE" },
    });
    emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: message });
    return;
  }

  await persistPrintifyShopifyVariantMapping({
    listingId,
    shopifyProductId: syncMatch.shopifyProductId,
    printifyProductId: printifyProductResult.productId,
    printifyRows,
    variantsBySku: syncMatch.variantsBySku,
  });

  await prisma.publishJob.update({
    where: { id: shopifyJob.id },
    data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
  });
  await prisma.listing.update({
    where: { id: listingId },
    data: {
      status: "ACTIVE",
      publishedAt: new Date(),
    },
  });

  emitEvent("publish.shopify.done", { shopifyProductId: syncMatch.shopifyProductId });
  emitEvent("publish.complete", {
    status: "ACTIVE",
    printifyProductId: printifyProductResult.productId,
    shopifyProductId: syncMatch.shopifyProductId,
  });
}
```

- [ ] **Step 4: Keep the existing Shopify token flow**

The worker already decrypts `shopifyAccessToken` before publish stages. Pass that string into `runPrintifyShopifyChannelPublish` as shown above. Do not add a second credential lookup through `store.credentials`.

- [ ] **Step 5: Add persistence helper**

Add below `runPrintifyShopifyChannelPublish`:

```ts
async function persistPrintifyShopifyVariantMapping(input: {
  listingId: string;
  shopifyProductId: string;
  printifyProductId: string;
  printifyRows: Array<{
    printifyVariantId: number;
    sku: string;
    colorName: string;
    colorHex: string | null;
    size: string;
  }>;
  variantsBySku: Map<string, { shopifyVariantId: string }>;
}): Promise<void> {
  const rows = input.printifyRows.map((row) => {
    const shopify = input.variantsBySku.get(row.sku);
    if (!shopify) {
      throw new Error(`Missing Shopify variant for SKU ${row.sku}`);
    }
    return {
      colorName: row.colorName,
      colorHex: row.colorHex ?? "",
      size: row.size,
      sku: row.sku,
      printifyVariantId: String(row.printifyVariantId),
      shopifyVariantId: shopify.shopifyVariantId,
    };
  });

  await prisma.$transaction([
    prisma.listingVariant.deleteMany({ where: { listingId: input.listingId } }),
    prisma.listingVariant.createMany({
      data: rows.map((row) => ({
        listingId: input.listingId,
        ...row,
      })),
    }),
    prisma.listing.update({
      where: { id: input.listingId },
      data: {
        shopifyProductId: input.shopifyProductId,
        printifyProductId: input.printifyProductId,
      },
    }),
  ]);
}
```

- [ ] **Step 6: Add `resolvePrintifyProductPublishInput` by extracting current Printify-stage logic**

Create this helper in `worker.ts` below `resolvePublishVariantIds`. It must reuse the current `runPrintifyStage` behavior:

```ts
async function resolvePrintifyProductPublishInput(input: {
  listing: any;
  draft: any;
  draftDesign: any;
  store: any;
  storage: any;
  printifyClient: Awaited<ReturnType<typeof getClientForStore>>["client"];
  externalShopId: number;
  productId: string | null;
}): Promise<{
  productId: string | null;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  variants?: Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }>;
  imageId: string;
  imageGroups?: Array<{ imageId: string; variantIds: number[] }>;
  placementData: PlacementData;
}> {
  const pair = input.listing.wizardDraftDesignPair ?? (input.listing.wizardDraftDesignPairId
    ? await prisma.wizardDraftDesignPair.findUnique({ where: { id: input.listing.wizardDraftDesignPairId } })
    : null);
  const template =
    input.draft.template ??
    (input.draft.storeId
      ? await prisma.storeMockupTemplate.findFirst({
          where: { storeId: input.draft.storeId, isDefault: true },
        })
      : null);

  if (!template?.printifyBlueprintId || !template?.printifyPrintProviderId) {
    throw new Error("Printify template is not configured for this store");
  }

  const cachedVariants = await ensureVariantCostCache({
    client: input.printifyClient,
    shopId: input.externalShopId,
    blueprintId: template.printifyBlueprintId,
    printProviderId: template.printifyPrintProviderId,
  });

  const selectedColorNames = ((input.draft.store as any)?.colors ?? [])
    .filter((color: any) => (input.draft.enabledColorIds ?? []).includes(color.id))
    .map((color: any) => color.name);

  const { effectiveVariantIds, effectiveSizesForPayload } = computeEnabledVariantSelection(
    cachedVariants,
    selectedColorNames,
    input.draft.enabledSizesByColor as Record<string, string[]> | null,
    input.draft.enabledSizes ?? [],
  );

  const baseRetailPriceUSD = resolveBaseTemplatePrice({
    templateBasePriceUsd: template.basePriceUsd,
    storeDefaultPriceUsd: (input.draft.store as any)?.defaultPriceUsd,
  });
  const priceBySizeOverride = mergeDraftAndTemplatePriceMaps({
    draftPriceBySizeOverride: input.draft.priceBySizeOverride,
    templatePriceBySizeDefault: template.priceBySizeDefault,
  });
  const enabledSet = new Set(effectiveVariantIds);
  const variants = buildVariantPayload(
    cachedVariants,
    selectedColorNames,
    effectiveSizesForPayload,
    baseRetailPriceUSD,
    priceBySizeOverride,
  ).map((variant) => ({
    ...variant,
    is_enabled: enabledSet.has(variant.id),
  }));

  const targetDesign = input.draftDesign?.design ?? input.draft.design ?? null;
  let imageId = "";
  let imageGroups: Array<{ imageId: string; variantIds: number[] }> | undefined;

  if (pair) {
    const lightDraftDesign = input.draft.draftDesigns.find((entry: any) => entry.id === pair.lightDraftDesignId);
    const darkDraftDesign = input.draft.draftDesigns.find((entry: any) => entry.id === pair.darkDraftDesignId);
    if (!lightDraftDesign?.design || !darkDraftDesign?.design) {
      throw new Error("Pair design files not found in draft");
    }

    const lightImageId = await ensurePrintifyImage({
      client: input.printifyClient,
      designStoragePath: lightDraftDesign.design.storagePath,
      cachedImageId: lightDraftDesign.printifyImageId,
    });
    const darkImageId = await ensurePrintifyImage({
      client: input.printifyClient,
      designStoragePath: darkDraftDesign.design.storagePath,
      cachedImageId: darkDraftDesign.printifyImageId,
    });

    await prisma.wizardDraftDesign.update({
      where: { id: lightDraftDesign.id },
      data: { printifyImageId: lightImageId },
    });
    await prisma.wizardDraftDesign.update({
      where: { id: darkDraftDesign.id },
      data: { printifyImageId: darkImageId },
    });

    const storeColors = (input.draft.store as any)?.colors ?? [];
    const colorNameToId = new Map<string, string>();
    for (const color of storeColors) {
      colorNameToId.set(color.name.trim().toLowerCase(), color.id);
    }
    const colorGroups = resolveColorGroups(storeColors);
    const lightVariantIds: number[] = [];
    const darkVariantIds: number[] = [];

    for (const variant of cachedVariants) {
      if (!enabledSet.has(variant.variantId)) continue;
      const colorId = colorNameToId.get(variant.colorName.trim().toLowerCase());
      const group = (() => {
        if (colorId) return colorGroups.get(colorId);
        const hex = variant.colorHex ?? "";
        if (/^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
          return classifyColorHex(hex);
        }
        return "light";
      })();
      if (group === "dark") darkVariantIds.push(variant.variantId);
      else lightVariantIds.push(variant.variantId);
    }

    imageGroups = [
      { imageId: lightImageId, variantIds: lightVariantIds },
      { imageId: darkImageId, variantIds: darkVariantIds },
    ];
  } else if (targetDesign?.storagePath) {
    imageId = await ensurePrintifyImage({
      client: input.printifyClient,
      designStoragePath: targetDesign.storagePath,
      cachedImageId: input.draftDesign?.printifyImageId ?? input.draft.printifyImageId,
    });
  } else {
    throw new Error("Design file not found");
  }

  return {
    productId: input.productId,
    blueprintId: template.printifyBlueprintId,
    printProviderId: template.printifyPrintProviderId,
    variantIds: effectiveVariantIds,
    variants,
    imageId,
    imageGroups,
    placementData:
      resolveEffectivePlacementData(input.draft.placementOverride, template.defaultPlacement) ??
      (targetDesign
        ? buildListingReadyPlacementData({
            design: { widthPx: targetDesign.width, heightPx: targetDesign.height },
            printArea: DEFAULT_PRINT_AREA,
            template: {
              productType: input.draft.productType,
              blueprintTitle: template.blueprintTitle,
              blueprintBrand: template.blueprintBrand,
            },
          })
        : defaultPlacementData()),
  };
}
```

- [ ] **Step 7: Add Printify create reconciliation helpers**

Add below `persistPrintifyShopifyVariantMapping`:

```ts
function isTransientPrintifyCreateError(error: unknown): boolean {
  return error instanceof PrintifyApiError && error.status >= 500 && error.status < 600;
}

async function findRecentPrintifyProductCandidate(input: {
  client: Awaited<ReturnType<typeof getClientForStore>>["client"];
  shopId: number;
  title: string;
  blueprintId: number;
  printProviderId: number;
}): Promise<{ id: string } | null> {
  for (let page = 1; page <= 3; page += 1) {
    const result = await input.client.getProducts(input.shopId, page);
    const candidate = (result.data ?? []).find((product) => {
      const title = product.title?.trim();
      return (
        (title === input.title || title === `Copy of ${input.title}`) &&
        Number(product.blueprint_id) === input.blueprintId &&
        Number(product.print_provider_id) === input.printProviderId
      );
    });
    if (candidate) return { id: candidate.id };
  }
  return null;
}
```

- [ ] **Step 8: Run worker tests and fix compile errors caused by extracted types**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: initial TypeScript/runtime failures are likely because this task moves code across a large existing worker. Fix only missing imports/type errors introduced by this task. Do not change behavior outside the Printify-first branch.

- [ ] **Step 9: Run all focused publish/printify tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/publish/strategy.test.ts \
  src/lib/printify/product-matrix.test.ts \
  src/lib/publish/shopify-sync.test.ts \
  src/lib/publish/worker.test.ts \
  src/lib/printify/product.test.ts \
  src/lib/printify/variant-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 10: No-commit checkpoint**

Run:

```bash
git status --short src/lib/publish/worker.ts src/lib/publish/worker.test.ts
```

Expected: files are modified. Do not run `git add` or `git commit`.

---

### Task 6: Retry Route Behavior

**Files:**
- Modify: `src/app/api/listings/[id]/retry-printify/route.ts`
- Test: `src/lib/publish/worker.test.ts` source-level coverage, because this route currently has no dedicated test harness.

- [ ] **Step 1: Read Next.js route handler docs before editing**

Run:

```bash
ls node_modules/next/dist/docs
```

Then read the relevant route-handler guide under `node_modules/next/dist/docs/` before editing this file. Keep the existing async `params` shape because this repo already uses it.

- [ ] **Step 2: Add a route source-level test**

Append to `src/lib/publish/worker.test.ts`:

```ts
describe("retry Printify route source contract", () => {
  it("routes Printify Shopify-channel retries through the full publish worker", () => {
    const retryRoute = readFileSync(
      new URL("../../app/api/listings/[id]/retry-printify/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(retryRoute, /resolvePublishStrategy/);
    assert.match(retryRoute, /runPublishWorker/);
    assert.match(retryRoute, /PRINTIFY_SHOPIFY_CHANNEL/);
  });
});
```

- [ ] **Step 3: Run the worker test and verify retry route assertion fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because the route does not resolve strategy.

- [ ] **Step 4: Update retry route imports**

In `src/app/api/listings/[id]/retry-printify/route.ts`, replace:

```ts
import { runPrintifyStage } from "@/lib/publish/worker";
```

with:

```ts
import { generateIdempotencyKey, runPrintifyStage, runPublishWorker } from "@/lib/publish/worker";
import { resolvePublishStrategy } from "@/lib/publish/strategy";
```

- [ ] **Step 5: Include `printifyShop` when loading store**

Replace:

```ts
const store = await prisma.store.findUnique({
  where: { id: listing.storeId },
});
```

with:

```ts
const store = await prisma.store.findUnique({
  where: { id: listing.storeId },
  include: { printifyShop: true },
});
```

- [ ] **Step 6: Route Shopify-channel retries through full worker**

Insert after the store null check:

```ts
if (resolvePublishStrategy(store) === "PRINTIFY_SHOPIFY_CHANNEL") {
  const shopifyJob = listing.publishJobs.find((job) => job.stage === "SHOPIFY");
  const printifyJob = listing.publishJobs.find((job) => job.stage === "PRINTIFY");
  for (const job of [shopifyJob, printifyJob]) {
    if (!job) continue;
    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: "PENDING", attempts: 0, lastError: null, completedAt: null },
    });
  }

  void runPublishWorker({
    listingId: listing.id,
    draftId: draft.id,
    tenantId: session.tenantId,
  }).catch((err) => console.error("[RetryPrintify] Full worker error:", err));

  return NextResponse.json({ ok: true, status: "retrying" });
}
```

Remove `generateIdempotencyKey` from the import if TypeScript reports it unused; it is not required for this route.

- [ ] **Step 7: Run the worker test and focused type check through test compile**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

- [ ] **Step 8: No-commit checkpoint**

Run:

```bash
git status --short 'src/app/api/listings/[id]/retry-printify/route.ts' src/lib/publish/worker.test.ts
```

Expected: files are modified. Do not run `git add` or `git commit`.

---

### Task 7: Focused Verification

**Files:**
- No new files.
- Verifies all files changed by the plan.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/publish/strategy.test.ts \
  src/lib/printify/product-matrix.test.ts \
  src/lib/publish/shopify-sync.test.ts \
  src/lib/publish/worker.test.ts \
  src/lib/printify/product.test.ts \
  src/lib/printify/variant-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. If the build fails because `next/font` cannot fetch Google Fonts in the sandbox, record that as an environment limitation and still run the focused tests plus `git diff --check`.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Verify no commit/add happened**

Run:

```bash
git status --short
```

Expected: modified and untracked files are visible. Do not run `git add` or `git commit`.

---

### Task 8: Manual Smoke On Production-Like Store

**Files:**
- No code changes.
- Uses the deployed app after implementation.

- [ ] **Step 1: Pick a new ThreadsMuse draft**

Use a new draft/listing only. Do not use an existing order or existing orphan product.

- [ ] **Step 2: Publish through the UI**

Expected UI behavior:

- publish starts
- Printify stage runs before Shopify sync
- no Shopify product appears before Printify publish succeeds

- [ ] **Step 3: Verify Printify product**

Read-only check:

```bash
GET /v1/shops/{threadsMusePrintifyShopId}/products/{printifyProductId}.json
```

Expected:

- product exists
- enabled variants have non-empty SKUs
- enabled variant count matches selected colors/sizes

- [ ] **Step 4: Verify Shopify product**

Read-only GraphQL check:

```graphql
query($id: ID!) {
  product(id: $id) {
    id
    title
    variants(first: 100) {
      nodes {
        id
        sku
        selectedOptions { name value }
      }
    }
  }
}
```

Expected:

- product exists
- every variant has a non-empty SKU
- Shopify SKU set equals enabled Printify SKU set

- [ ] **Step 5: Verify DB mapping**

Read-only SQL:

```sql
select
  count(*) as rows,
  count(*) filter (where sku is null or sku = '') as empty_sku,
  count(*) filter (where printify_variant_id is null or printify_variant_id = '') as empty_printify_variant,
  count(*) filter (where shopify_variant_id is null or shopify_variant_id = '') as empty_shopify_variant
from listing_variants
where listing_id = '<new_listing_id>';
```

Expected:

- `rows` equals enabled Printify variant count
- `empty_sku = 0`
- `empty_printify_variant = 0`
- `empty_shopify_variant = 0`

- [ ] **Step 6: Verify fulfillability with a test order only**

Create or inspect a test order for the new product. Expected: Shopify line item SKU maps to Printify and is fulfillable. Do not modify live customer orders during this smoke.
