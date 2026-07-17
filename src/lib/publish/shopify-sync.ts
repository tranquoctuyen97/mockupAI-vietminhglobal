import type { EnabledPrintifyVariantMatrixRow } from "@/lib/printify/product-matrix";
import type { PrintifyProductResponse } from "@/lib/printify/client";
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

type ShopifyProductVariantsResponse = {
  productVariants: {
    nodes: ShopifyVariantCandidate[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type ShopifyProductByIdResponse = {
  product: {
    id: string;
    title: string;
    handle?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    variants: {
      nodes: Array<{
        id: string;
        sku: string | null;
        selectedOptions: Array<{ name: string; value: string }>;
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
};

export class ShopifySyncTimeoutError extends Error {
  constructor(timeoutMs: number, detail?: string) {
    super(`Timed out waiting ${timeoutMs}ms for Shopify product sync${detail ? `: ${detail}` : ""}`);
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
    const group = byProduct.get(candidate.product.id) ?? [];
    group.push(candidate);
    byProduct.set(candidate.product.id, group);
  }

  const sortedGroups = [...byProduct.values()].sort((a, b) =>
    (b[0]?.product.updatedAt ?? "").localeCompare(a[0]?.product.updatedAt ?? ""),
  );

  for (const group of sortedGroups) {
    const variantsBySku = new Map<
      string,
      { shopifyVariantId: string; selectedOptions: Array<{ name: string; value: string }> }
    >();
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
    return { shopifyProductId: group[0].product.id, variantsBySku };
  }

  return null;
}

export async function fetchRecentShopifyVariantCandidates(input: {
  client: Pick<ShopifyClient, "graphql">;
  updatedAfterIso: string;
  title?: string;
  maxPages?: number;
}): Promise<ShopifyVariantCandidate[]> {
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
  const titleFilter = input.title?.trim().toLowerCase() ?? "";
  const maxPages = input.maxPages ?? 5;
  let after: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data: ShopifyProductVariantsResponse =
      await input.client.graphql<ShopifyProductVariantsResponse>(query, {
      first: 100,
      after,
      query: `updated_at:>${input.updatedAfterIso}`,
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

export async function waitForPrintifyShopifySync(input: {
  printifyRows: EnabledPrintifyVariantMatrixRow[];
  printifyShopId: number;
  printifyProductId: string;
  printifyClient: { getProduct: (shopId: number, productId: string) => Promise<PrintifyProductResponse> };
  shopifyClient: Pick<ShopifyClient, "graphql">;
  updatedAfterIso: string;
  timeoutMs: number;
  intervalMs: number;
  title?: string;
  log?: (message: string, data?: Record<string, unknown>) => void;
  onShopifyProductFound?: (product: {
    shopifyProductId: string;
    source: "printify_external" | "sku_search";
  }) => Promise<void> | void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ShopifySyncMatch> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let lastExternalCount = 0;
  let lastCandidateCount = 0;
  let lastBestOverlap = 0;
  let notifiedShopifyProductId: string | null = null;

  while (now() - startedAt <= input.timeoutMs) {
    const printifyProduct = await input.printifyClient.getProduct(input.printifyShopId, input.printifyProductId);
    const externalIds = extractExternalProductIds(printifyProduct);
    lastExternalCount = externalIds.length;

    for (const externalId of externalIds) {
      const productId = toShopifyProductGid(externalId);
      const match = await fetchShopifyProductById(input.shopifyClient, productId);
      if (!match) continue;
      if (match.id !== notifiedShopifyProductId) {
        notifiedShopifyProductId = match.id;
        await input.onShopifyProductFound?.({
          shopifyProductId: match.id,
          source: "printify_external",
        });
      }
      const syncMatch = selectShopifyProductCandidate(input.printifyRows, productVariantsToCandidates(match));
      if (syncMatch) {
        input.log?.("[PublishWorker] Shopify sync matched by Printify external id", {
          printifyProductId: input.printifyProductId,
          shopifyProductId: syncMatch.shopifyProductId,
          externalCount: externalIds.length,
        });
        return syncMatch;
      }
    }

    const candidates = await fetchRecentShopifyVariantCandidates({
      client: input.shopifyClient,
      updatedAfterIso: input.updatedAfterIso,
      title: input.title,
      maxPages: 10,
    });
    lastCandidateCount = candidates.length;
    lastBestOverlap = bestSkuOverlap(input.printifyRows, candidates);
    const searchMatch = selectShopifyProductCandidate(input.printifyRows, candidates);
    if (searchMatch) {
      if (searchMatch.shopifyProductId !== notifiedShopifyProductId) {
        notifiedShopifyProductId = searchMatch.shopifyProductId;
        await input.onShopifyProductFound?.({
          shopifyProductId: searchMatch.shopifyProductId,
          source: "sku_search",
        });
      }
      input.log?.("[PublishWorker] Shopify sync matched by SKU search", {
        printifyProductId: input.printifyProductId,
        shopifyProductId: searchMatch.shopifyProductId,
        candidateCount: candidates.length,
        bestOverlap: lastBestOverlap,
      });
      return searchMatch;
    }

    input.log?.("[PublishWorker] Waiting for Shopify sync", {
      printifyProductId: input.printifyProductId,
      externalCount: lastExternalCount,
      candidateCount: lastCandidateCount,
      bestOverlap: lastBestOverlap,
    });
    await sleep(input.intervalMs);
  }

  throw new ShopifySyncTimeoutError(
    input.timeoutMs,
    `externalCount=${lastExternalCount}, candidateCount=${lastCandidateCount}, bestOverlap=${lastBestOverlap}`,
  );
}

export function extractExternalProductIds(product: Pick<PrintifyProductResponse, "external">): string[] {
  const entries = Array.isArray(product.external)
    ? product.external
    : product.external
      ? [product.external]
      : [];
  return entries
    .map((entry) => entry?.id?.trim())
    .filter((id): id is string => Boolean(id));
}

export function toShopifyProductGid(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("gid://") ? trimmed : `gid://shopify/Product/${trimmed}`;
}

async function fetchShopifyProductById(
  client: Pick<ShopifyClient, "graphql">,
  productId: string,
): Promise<ShopifyProductByIdResponse["product"]> {
  const query = `
    query ProductForPrintifyExternal($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        createdAt
        updatedAt
        variants(first: 100) {
          nodes {
            id
            sku
            selectedOptions { name value }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  const data = await client.graphql<ShopifyProductByIdResponse>(query, { id: productId });
  return data.product;
}

function productVariantsToCandidates(product: NonNullable<ShopifyProductByIdResponse["product"]>): ShopifyVariantCandidate[] {
  return product.variants.nodes.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    selectedOptions: variant.selectedOptions,
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    },
  }));
}

function bestSkuOverlap(
  printifyRows: EnabledPrintifyVariantMatrixRow[],
  candidates: ShopifyVariantCandidate[],
): number {
  const expectedSkus = new Set(printifyRows.map((row) => row.sku.trim()).filter(Boolean));
  const byProduct = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const sku = candidate.sku?.trim();
    if (!sku) continue;
    const skus = byProduct.get(candidate.product.id) ?? new Set<string>();
    skus.add(sku);
    byProduct.set(candidate.product.id, skus);
  }
  let best = 0;
  for (const skus of byProduct.values()) {
    let overlap = 0;
    for (const sku of skus) if (expectedSkus.has(sku)) overlap += 1;
    if (overlap > best) best = overlap;
  }
  return best;
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
