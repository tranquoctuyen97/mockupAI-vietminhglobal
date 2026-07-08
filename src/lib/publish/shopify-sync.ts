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

type ShopifyProductVariantsResponse = {
  productVariants: {
    nodes: ShopifyVariantCandidate[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
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
