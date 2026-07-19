/**
 * Shopify Publish — Create product via GraphQL Admin API
 *
 * Flow (API 2025-04+):
 * 1. productSet — atomic: title, descriptionHtml, vendor, productType, category,
 *    tags, options (Color + Size), variants (SKU, CONTINUE), status ACTIVE
 * 2. Upload mockup images via stagedUploadsCreate + productCreateMedia, then
 *    productReorderMedia to put the primary color thumbnail at position 0
 * 3. publishablePublish to every active publication (paginated, per-channel guard)
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { formatDescriptionHtml } from "@/lib/content/description-html";
import type { ShopifyClient } from "@/lib/shopify/client";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";

export type ShopifyMockupImage =
  | { kind: "local"; path: string; colorName?: string }
  | { kind: "remote"; url: string; colorName?: string };

export interface ShopifyVariantInput {
  colorName: string;
  size?: string | null; // null / "" / "ONE_SIZE" → no Size option
  sku?: string | null;
  priceUsd: number;
}

export interface ShopifyPublishInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  priceUsd: number;
  productType: string;
  vendor?: string;
  colors: Array<{ name: string; hex: string }>;
  variants?: ShopifyVariantInput[]; // full desired variant list (Color + Size + SKU + price)
  primaryColorName?: string | null; // color whose media should become the thumbnail
  mockupPaths: string[]; // absolute file paths
  mockupImages?: ShopifyMockupImage[];
  organizationCollections?: string[];
  existingProductId?: string | null; // for retry idempotency
  onProductCreated?: (
    productId: string,
    variantNodes: ShopifyProductVariantNode[],
  ) => Promise<void>;
}

export interface ShopifyPublishResult {
  shopifyProductId: string;
  shopifyVariantIds: string[];
  variantNodes: ShopifyProductVariantNode[];
  shopifyProductUrl: string;
}

export interface ShopifyPublishChannelsResult {
  attempted: number;
  succeeded: number;
  failed: Array<{ publicationId: string; message: string }>;
}

const DEFAULT_VENDOR = "Printify";
const DEFAULT_SHOPIFY_INVENTORY_QUANTITY = 999;
const TAXONOMY_BASE = "gid://shopify/TaxonomyCategory/";

export type ShopifyProductVariantNode = {
  id: string;
  sku: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem?: { id: string } | null;
};

type CollectionResolverClient = Pick<ShopifyClient, "graphql">;

type ShopifyCollectionNode = {
  id: string;
  title: string;
  handle: string;
  ruleSet: { appliedDisjunctively: boolean } | null;
};

/**
 * Canonical apparel type → Shopify Taxonomy category GID.
 * GIDs taken from the official Shopify product taxonomy (Apparel & Accessories
 * > Clothing > Clothing Tops). Validated at runtime before use, so a
 * version-mismatched GID is omitted rather than failing the publish.
 */
const PRODUCT_TYPE_TAXONOMY_MAP: Record<string, string> = {
  "T-Shirt": `${TAXONOMY_BASE}aa-1-13-8`,
  "Tank Top": `${TAXONOMY_BASE}aa-1-13-9`,
  Sweater: `${TAXONOMY_BASE}aa-1-13-12`,
  Hoodie: `${TAXONOMY_BASE}aa-1-13-13`,
  Sweatshirt: `${TAXONOMY_BASE}aa-1-13-14`,
  "Long Sleeve Shirt": `${TAXONOMY_BASE}aa-1-13-7`,
  Polo: `${TAXONOMY_BASE}aa-1-13-6`,
};

/** Canonical apparel type → Printify-like default tags (not exact Printify app tags). */
const PRODUCT_TYPE_TAG_MAP: Record<string, string[]> = {
  "T-Shirt": [
    "T-Shirt",
    "Printify",
    "Unisex",
    "DTG",
    "Cotton",
    "Crew neck",
    "Men's Clothing",
    "Women's Clothing",
  ],
  "Tank Top": [
    "Tank Top",
    "Printify",
    "Unisex",
    "Sleeveless",
    "Summer Wear",
    "Men's Clothing",
    "Women's Clothing",
  ],
  Sweater: ["Sweater", "Printify", "Unisex", "Knitwear", "Winter Wear", "Long Sleeve"],
  Hoodie: ["Hoodie", "Printify", "Unisex", "Outerwear", "Sweatshirt", "Winter Wear", "Long Sleeve"],
  Sweatshirt: ["Sweatshirt", "Printify", "Unisex", "Outerwear", "Winter Wear", "Long Sleeve"],
  "Long Sleeve Shirt": ["Long Sleeve Shirt", "Printify", "Unisex", "Long Sleeve", "T-Shirt"],
  Polo: ["Polo", "Printify", "Unisex", "Collared Shirt", "Short Sleeve"],
};

/** Canonical apparel type → manual collection title to resolve (exact title/handle only). */
const PRODUCT_TYPE_COLLECTION_MAP: Record<string, string> = {
  "T-Shirt": "T-Shirts",
  "Tank Top": "Tank Tops",
  Sweater: "Sweaters",
  Hoodie: "Hoodies",
  Sweatshirt: "Sweatshirts",
  "Long Sleeve Shirt": "Long Sleeve Shirts",
  Polo: "Polos",
};

/**
 * Map a raw product type (e.g. Printify blueprint title "Unisex Heavy Cotton Tee")
 * to a canonical apparel type. Returns null when unrecognized → caller keeps the
 * raw type and skips category/default-tag mapping.
 */
export function normalizeProductType(raw: string): string | null {
  const s = (raw || "").toLowerCase();
  if (/hoodie/.test(s)) return "Hoodie";
  if (/sweatshirt/.test(s)) return "Sweatshirt";
  if (/tank/.test(s)) return "Tank Top";
  if (/sweater/.test(s)) return "Sweater";
  if (/polo/.test(s)) return "Polo";
  if (/long\s*sleeve/.test(s)) return "Long Sleeve Shirt";
  if (/t-?shirt|tee\b|\btee/.test(s)) return "T-Shirt";
  return null;
}

function normalizeSize(size?: string | null): string | null {
  if (!size) return null;
  const trimmed = size.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toUpperCase() === "ONE_SIZE") return null;
  return trimmed;
}

/** Merge Printify-like default tags with AI tags, de-duplicated case-insensitively. */
export function buildProductTags(canonicalType: string | null, aiTags: string[]): string[] {
  const defaults = canonicalType ? (PRODUCT_TYPE_TAG_MAP[canonicalType] ?? []) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...defaults, ...(aiTags ?? [])]) {
    const trimmed = (tag ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Publish product to Shopify using productSet mutation (2025-04+)
 *
 * Idempotent: if existingProductId is provided, skips product creation
 * and only uploads images + publishes.
 */
export async function publishToShopify(
  client: ShopifyClient,
  domain: string,
  input: ShopifyPublishInput,
): Promise<ShopifyPublishResult> {
  let productId: string;
  let variantIds: string[];
  let variantNodes: ShopifyProductVariantNode[] = [];

  if (input.existingProductId) {
    console.log(`[Shopify] Reusing existing product: ${input.existingProductId}`);
    productId = input.existingProductId;
    variantNodes = await fetchProductVariantNodes(client, productId);
    variantIds = variantNodes.map((variant) => variant.id);
    await enableInventoryTrackingAndSetStock(client, variantNodes);
  } else {
    // Step 1: Create product + options + variants atomically
    const productResult = await createProductWithSet(client, input);
    productId = productResult.productId;
    variantNodes = await fetchProductVariantNodes(client, productId);
    if (variantNodes.length === 0) variantNodes = productResult.variantNodes;
    variantIds = variantNodes.map((v) => v.id);
    await input.onProductCreated?.(productId, variantNodes);

    // Enable inventory tracking — Shopify defaults tracked=false,
    // so without this the 999 quantity we set is invisible.
    await enableInventoryTrackingAndSetStock(client, variantNodes);
  }

  return {
    shopifyProductId: productId,
    shopifyVariantIds: variantIds,
    variantNodes,
    shopifyProductUrl: `https://${domain}/admin/products/${extractNumericId(productId)}`,
  };
}

/**
 * Create product using productSet mutation (API 2025-04+)
 * Sets status: ACTIVE so product is immediately visible without needing publishablePublish
 */
async function createProductWithSet(
  client: ShopifyClient,
  input: ShopifyPublishInput,
): Promise<{
  productId: string;
  variantNodes: ShopifyProductVariantNode[];
}> {
  const mutation = `
    mutation productSet($synchronous: Boolean!, $productSet: ProductSetInput!) {
      productSet(synchronous: $synchronous, input: $productSet) {
        product {
          id
          variants(first: 100) {
            nodes {
              id
              sku
              selectedOptions { name value }
              inventoryItem { id }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const hasColors = input.colors.length > 0;

  const canonicalType = normalizeProductType(input.productType);
  // Product organization: clean Type, Vendor=Printify, taxonomy category, default tags.
  const productType = canonicalType ?? input.productType;
  const vendor = input.vendor ?? DEFAULT_VENDOR;
  const tags = buildProductTags(canonicalType, input.tags);
  const [categoryId, collectionIds, locationId] = await Promise.all([
    resolveCategoryId(client, canonicalType),
    resolveProductCollectionIds(client, canonicalType, input.organizationCollections),
    resolveDefaultLocationId(client),
  ]);

  // Variant matrix: prefer the full desired list (Color + Size + SKU + price)
  // when provided by the worker, otherwise fall back to colors-only.
  const variantInputs = input.variants && input.variants.length > 0 ? input.variants : null;
  const sizesInOrder: string[] = [];
  if (variantInputs) {
    for (const v of variantInputs) {
      const size = normalizeSize(v.size);
      if (size && !sizesInOrder.includes(size)) sizesInOrder.push(size);
    }
  }
  // Only expose a Size option when every variant carries a size (consistent matrix).
  const hasSizes =
    variantInputs != null &&
    sizesInOrder.length > 0 &&
    variantInputs.every((v) => normalizeSize(v.size) != null);

  const productOptions: Array<{ name: string; position: number; values: Array<{ name: string }> }> =
    [];
  if (hasColors) {
    productOptions.push({
      name: "Color",
      position: 1,
      values: input.colors.map((c) => ({ name: c.name })),
    });
  }
  if (hasSizes) {
    productOptions.push({
      name: "Size",
      position: hasColors ? 2 : 1,
      values: sizesInOrder.map((s) => ({ name: s })),
    });
  }

  const variants = buildVariantSetInputs(input, hasColors, hasSizes, locationId);

  const productSetInput: Record<string, unknown> = {
    title: input.title,
    descriptionHtml: formatDescriptionHtml(input.descriptionHtml),
    tags,
    productType,
    vendor,
    status: "ACTIVE", // Publish immediately — no need for separate publishablePublish
    variants,
  };
  if (productOptions.length > 0) productSetInput.productOptions = productOptions;
  if (categoryId) productSetInput.category = categoryId;
  if (collectionIds.length > 0) productSetInput.collections = collectionIds;

  const variables = { synchronous: true, productSet: productSetInput };

  const data = (await client.graphql(mutation, variables)) as {
    productSet: {
      product: {
        id: string;
        variants: {
          nodes: ShopifyProductVariantNode[];
        };
      };
      userErrors: Array<{ field: string | string[] | null; message: string }>;
    };
  };

  if (data.productSet.userErrors.length > 0) {
    const errors = data.productSet.userErrors.map((e) => {
      const field = Array.isArray(e.field) ? e.field.join(".") : e.field;
      return field ? `${field}: ${e.message}` : e.message;
    });
    throw new Error(`Shopify productSet failed: ${errors.join("; ")}`);
  }

  return {
    productId: data.productSet.product.id,
    variantNodes: data.productSet.product.variants.nodes,
  };
}

export async function fetchProductVariantNodes(
  client: Pick<ShopifyClient, "graphql">,
  productId: string,
): Promise<ShopifyProductVariantNode[]> {
  const query = `
    query ProductVariantNodes($id: ID!, $first: Int!, $after: String) {
      product(id: $id) {
        id
        variants(first: $first, after: $after) {
          nodes {
            id
            sku
            selectedOptions { name value }
            inventoryItem { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  const variants: ShopifyProductVariantNode[] = [];
  let after: string | null = null;
  do {
    const data = (await client.graphql(query, {
      id: productId,
      first: 100,
      after,
    })) as {
      product: {
        variants: {
          nodes: ShopifyProductVariantNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    };
    if (!data.product) throw new Error(`Shopify product not found: ${productId}`);
    variants.push(...data.product.variants.nodes);
    after = data.product.variants.pageInfo.hasNextPage
      ? data.product.variants.pageInfo.endCursor
      : null;
  } while (after);

  return variants;
}

export async function uploadProductImages(
  client: ShopifyClient,
  productId: string,
  mockupImages: ShopifyMockupImage[],
): Promise<Array<{ mediaId: string; colorName?: string }>> {
  if (mockupImages.length === 0) return [];

  const mediaSources: Array<{ originalSource: string; colorName?: string }> = [];
  const localImages = mockupImages.filter(
    (image): image is Extract<ShopifyMockupImage, { kind: "local" }> => image.kind === "local",
  );

  for (const image of mockupImages) {
    if (image.kind === "remote") {
      mediaSources.push({
        originalSource: image.url,
        colorName: image.colorName,
      });
    }
  }

  if (localImages.length > 0) {
    const uploadedLocalSources = await stageLocalProductImages(client, localImages);
    mediaSources.push(...uploadedLocalSources);
  }

  if (mediaSources.length === 0) return [];

  const mediaMutation = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }
  `;

  const mediaResult = (await client.graphql(mediaMutation, {
    productId,
    media: mediaSources.map((source) => ({
      originalSource: source.originalSource,
      mediaContentType: "IMAGE",
    })),
  })) as {
    productCreateMedia: {
      media: Array<{ id: string }>;
      mediaUserErrors: Array<{ field: string; message: string }>;
    };
  };

  if (mediaResult.productCreateMedia.mediaUserErrors.length > 0) {
    throw new Error(
      `Shopify productCreateMedia failed: ${mediaResult.productCreateMedia.mediaUserErrors.map((e) => e.message).join("; ")}`,
    );
  }

  return mediaResult.productCreateMedia.media.map((m, i) => ({
    mediaId: m.id,
    colorName: mediaSources[i].colorName,
  }));
}

/**
 * Detect image MIME type from magic bytes in the buffer header.
 * Falls back to extension-based detection, then "image/png".
 */
function detectImageMime(buffer: Buffer, filePath: string): { mime: string; ext: string } {
  // Check magic bytes (first 4-12 bytes)
  if (buffer.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { mime: "image/png", ext: ".png" };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mime: "image/jpeg", ext: ".jpg" };
    }
    // WEBP: RIFF....WEBP
    if (
      buffer[0] === 0x52 && // R
      buffer[1] === 0x49 && // I
      buffer[2] === 0x46 && // F
      buffer[3] === 0x46 && // F
      buffer.length >= 12 &&
      buffer[8] === 0x57 && // W
      buffer[9] === 0x45 && // E
      buffer[10] === 0x42 && // B
      buffer[11] === 0x50 // P
    ) {
      return { mime: "image/webp", ext: ".webp" };
    }
    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return { mime: "image/gif", ext: ".gif" };
    }
  }

  // Fallback: guess from file extension
  const currentExt = extname(filePath).toLowerCase();
  const extMap: Record<string, { mime: string; ext: string }> = {
    ".png": { mime: "image/png", ext: ".png" },
    ".jpg": { mime: "image/jpeg", ext: ".jpg" },
    ".jpeg": { mime: "image/jpeg", ext: ".jpeg" },
    ".webp": { mime: "image/webp", ext: ".webp" },
    ".gif": { mime: "image/gif", ext: ".gif" },
  };
  return extMap[currentExt] ?? { mime: "image/png", ext: ".png" };
}

async function stageLocalProductImages(
  client: ShopifyClient,
  localImages: Array<Extract<ShopifyMockupImage, { kind: "local" }>>,
): Promise<Array<{ originalSource: string; colorName?: string }>> {
  // Step 1: Read all file buffers first to detect actual MIME types
  const fileData = await Promise.all(
    localImages.map(async (img) => {
      const buffer = await readFile(img.path);
      const detected = detectImageMime(buffer, img.path);
      // Build filename with correct extension matching the detected MIME
      const nameWithoutExt = basename(img.path, extname(img.path));
      const correctedFilename = `${nameWithoutExt}${detected.ext}`;
      return { img, buffer, mime: detected.mime, filename: correctedFilename };
    }),
  );

  // Step 2: Create staged uploads with correct filename + mimeType
  const stagesMutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

  const stagedInput = fileData.map((f) => ({
    filename: f.filename,
    mimeType: f.mime,
    httpMethod: "PUT",
    resource: "PRODUCT_IMAGE",
  }));

  const stagedData = (await client.graphql(stagesMutation, { input: stagedInput })) as {
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ field: string; message: string }>;
    };
  };

  if (stagedData.stagedUploadsCreate.userErrors.length > 0) {
    throw new Error(
      `Shopify stagedUploadsCreate failed: ${stagedData.stagedUploadsCreate.userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  const targets = stagedData.stagedUploadsCreate.stagedTargets;

  // Step 3: Upload file buffers with correct Content-Type
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    await fetch(target.url, {
      method: "PUT",
      headers: { "Content-Type": fileData[i].mime },
      body: fileData[i].buffer,
    });
  }

  return targets.map((target, index) => ({
    originalSource: target.resourceUrl,
    colorName: localImages[index].colorName,
  }));
}

/**
 * Build the full desired variant list for productSet.
 * Each variant carries Color (+ Size when consistent), price, SKU and
 * inventoryPolicy CONTINUE (keep selling when out of stock).
 */
function buildVariantSetInputs(
  input: ShopifyPublishInput,
  hasColors: boolean,
  hasSizes: boolean,
  locationId: string | null,
): Array<Record<string, unknown>> {
  const variantInputs = input.variants && input.variants.length > 0 ? input.variants : null;

  if (variantInputs) {
    return variantInputs.map((v) => {
      const optionValues: Array<{ optionName: string; name: string }> = [];
      if (hasColors) optionValues.push({ optionName: "Color", name: v.colorName });
      const size = normalizeSize(v.size);
      if (hasSizes && size) optionValues.push({ optionName: "Size", name: size });

      const variant: Record<string, unknown> = {
        price: v.priceUsd,
        inventoryPolicy: "CONTINUE",
      };
      addDefaultInventoryQuantity(variant, locationId);
      if (optionValues.length > 0) variant.optionValues = optionValues;
      if (v.sku) variant.sku = v.sku;
      return variant;
    });
  }

  if (hasColors) {
    return input.colors.map((c) => {
      const variant: Record<string, unknown> = {
        optionValues: [{ optionName: "Color", name: c.name }],
        price: input.priceUsd,
        inventoryPolicy: "CONTINUE",
      };
      addDefaultInventoryQuantity(variant, locationId);
      return variant;
    });
  }

  const variant: Record<string, unknown> = {
    price: input.priceUsd,
    inventoryPolicy: "CONTINUE",
  };
  addDefaultInventoryQuantity(variant, locationId);
  return [variant];
}

function addDefaultInventoryQuantity(
  variant: Record<string, unknown>,
  locationId: string | null,
): void {
  if (!locationId) return;
  variant.inventoryQuantities = [
    {
      locationId,
      name: "available",
      quantity: DEFAULT_SHOPIFY_INVENTORY_QUANTITY,
    },
  ];
}

async function resolveDefaultLocationId(client: ShopifyClient): Promise<string | null> {
  try {
    const query = `
      query GetDefaultLocation {
        locations(first: 1) {
          nodes {
            id
          }
        }
      }
    `;
    const data = (await client.graphql(query, {})) as {
      locations: { nodes: Array<{ id: string }> };
    };
    return data.locations.nodes[0]?.id ?? null;
  } catch (err) {
    console.warn(
      "[Shopify] Failed to resolve default location, omitting inventory quantities:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Enable inventory tracking for all variants and set initial stock.
 * Shopify defaults tracked=false, and any inventoryQuantities passed
 * during productSet for untracked items are discarded.
 * Therefore, we must enable tracking first, then manually set quantities.
 */
async function enableInventoryTrackingAndSetStock(
  client: ShopifyClient,
  variantNodes: Array<{ inventoryItem?: { id: string } | null }>,
): Promise<void> {
  const inventoryItemIds = variantNodes
    .map((v) => v.inventoryItem?.id)
    .filter((id): id is string => Boolean(id));

  if (inventoryItemIds.length === 0) {
    console.warn("[Shopify] No inventory item IDs — skipping tracking enable");
    return;
  }

  // 1. Enable tracking (Promise.allSettled)
  const trackMutation = `
    mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem { id tracked }
        userErrors { message }
      }
    }
  `;

  await Promise.allSettled(
    inventoryItemIds.map((id) => client.graphql(trackMutation, { id, input: { tracked: true } })),
  );

  // 2. Resolve location to set stock
  const locationId = await resolveDefaultLocationId(client);
  if (!locationId) {
    console.warn("[Shopify] Could not resolve location for setting quantities");
    return;
  }

  // 3. Set stock to 999
  const setQuantitiesMutation = `
    mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { message }
      }
    }
  `;

  try {
    await client.graphql(setQuantitiesMutation, {
      input: {
        name: "available",
        ignoreCompareQuantity: true,
        reason: "correction",
        quantities: inventoryItemIds.map((id) => ({
          inventoryItemId: id,
          locationId,
          quantity: DEFAULT_SHOPIFY_INVENTORY_QUANTITY,
        })),
      },
    });
    console.log(
      `[Shopify] Enabled tracking and set stock to ${DEFAULT_SHOPIFY_INVENTORY_QUANTITY} for ${inventoryItemIds.length} item(s)`,
    );
  } catch (err) {
    console.warn("[Shopify] Failed to set inventory quantities:", err);
  }
}

/**
 * Resolve a Shopify Taxonomy category GID for the canonical product type.
 * Validates the GID resolves to a TaxonomyCategory in the store's API version;
 * returns null (omit category → Shopify auto-classifies) on miss/invalid.
 */
async function resolveCategoryId(
  client: CollectionResolverClient,
  canonicalType: string | null,
): Promise<string | null> {
  if (!canonicalType) return null;
  const gid = PRODUCT_TYPE_TAXONOMY_MAP[canonicalType];
  if (!gid) {
    console.warn(`[Shopify] No taxonomy mapping for "${canonicalType}", omitting category`);
    return null;
  }

  try {
    const query = `
      query ValidateCategory($id: ID!) {
        node(id: $id) {
          __typename
          ... on TaxonomyCategory { id }
        }
      }
    `;
    const data = (await client.graphql(query, { id: gid })) as {
      node: { __typename: string; id?: string } | null;
    };
    if (data.node && data.node.__typename === "TaxonomyCategory") return gid;
    console.warn(`[Shopify] Taxonomy GID ${gid} not valid in this API version, omitting category`);
    return null;
  } catch (err) {
    console.warn(
      `[Shopify] Taxonomy validation failed, omitting category:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Move the primary color's media to position 0 so it becomes the product
 * thumbnail. Non-fatal — the product is already created/published.
 */
export async function reorderPrimaryMedia(
  client: ShopifyClient,
  productId: string,
  mediaId: string,
): Promise<void> {
  const mutation = `
    mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        job { id }
        userErrors { field message }
      }
    }
  `;
  try {
    const data = (await client.graphql(mutation, {
      id: productId,
      moves: [{ id: mediaId, newPosition: "0" }],
    })) as { productReorderMedia: { userErrors: Array<{ field: string; message: string }> } };
    const errors = data.productReorderMedia?.userErrors ?? [];
    if (errors.length > 0) {
      console.warn(`[Shopify] productReorderMedia userErrors (non-fatal):`, errors);
    }
  } catch (err) {
    console.warn(
      `[Shopify] productReorderMedia failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

type ProductOptionForReorder = {
  id?: string;
  name: string;
  optionValues?: Array<{ id?: string; name: string; hasVariants?: boolean }>;
  values?: string[];
};

function normalizeOptionName(value: string): string {
  return value.trim().toLowerCase();
}

function optionValueNames(option: ProductOptionForReorder): string[] {
  if (Array.isArray(option.optionValues) && option.optionValues.length > 0) {
    return option.optionValues.map((value) => value.name).filter((name) => name.trim().length > 0);
  }
  return (option.values ?? []).filter((name) => name.trim().length > 0);
}

export function orderOptionValuesByPrimary(
  values: string[],
  primaryValueName: string | null | undefined,
): string[] {
  if (!primaryValueName) return values;
  const primaryKey = normalizeOptionName(primaryValueName);
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const ar = normalizeOptionName(a.value) === primaryKey ? -1 : a.index;
      const br = normalizeOptionName(b.value) === primaryKey ? -1 : b.index;
      return ar - br;
    })
    .map((entry) => entry.value);
}

export async function reorderProductOptionsByPrimaryColor(input: {
  client: CollectionResolverClient;
  productId: string;
  primaryColorName: string | null | undefined;
}): Promise<boolean> {
  if (!input.primaryColorName) return false;

  const query = `
    query ProductOptionsForReorder($id: ID!) {
      product(id: $id) {
        id
        options {
          id
          name
          position
          values
          optionValues {
            id
            name
            hasVariants
          }
        }
      }
    }
  `;
  const data = (await input.client.graphql(query, { id: input.productId })) as {
    product: { options: ProductOptionForReorder[] } | null;
  };
  const options = data.product?.options ?? [];
  if (options.length === 0) return false;

  const colorOption = options.find((option) => normalizeOptionName(option.name) === "color");
  if (!colorOption) return false;

  const currentColorValues = optionValueNames(colorOption);
  const reorderedColorValues = orderOptionValuesByPrimary(
    currentColorValues,
    input.primaryColorName,
  );
  const changed = reorderedColorValues.some((value, index) => value !== currentColorValues[index]);
  if (!changed) return false;

  const mutation = `
    mutation ReorderProductOptions($productId: ID!, $options: [OptionReorderInput!]!) {
      productOptionsReorder(productId: $productId, options: $options) {
        product { id }
        userErrors { field message code }
      }
    }
  `;
  const mutationData = (await input.client.graphql(mutation, {
    productId: input.productId,
    options: options.map((option) => ({
      name: option.name,
      ...(normalizeOptionName(option.name) === "color"
        ? { values: reorderedColorValues.map((name) => ({ name })) }
        : {}),
    })),
  })) as {
    productOptionsReorder: {
      userErrors: Array<{
        field?: string | string[] | null;
        message: string;
        code?: string | null;
      }>;
    };
  };

  const errors = mutationData.productOptionsReorder?.userErrors ?? [];
  if (errors.length > 0) {
    const messages = errors.map((error) => {
      const field = Array.isArray(error.field) ? error.field.join(".") : error.field;
      return field ? `${field}: ${error.message}` : error.message;
    });
    throw new Error(`Shopify productOptionsReorder failed: ${messages.join("; ")}`);
  }

  return true;
}

export async function updateProductCategory(input: {
  client: CollectionResolverClient;
  productId: string;
  productType: string | null | undefined;
}): Promise<string | null> {
  const canonicalType = normalizeProductType(input.productType ?? "");
  const categoryId = await resolveCategoryId(input.client, canonicalType);
  if (!categoryId) return null;

  const mutation = `
    mutation UpdateProductCategory($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }
  `;
  const data = (await input.client.graphql(mutation, {
    product: {
      id: input.productId,
      category: categoryId,
      productType: canonicalType ?? input.productType,
    },
  })) as {
    productUpdate: {
      product: { id: string } | null;
      userErrors: Array<{ field: string[] | string | null; message: string }>;
    };
  };
  const errors = data.productUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `Shopify productUpdate category failed: ${errors.map((error) => error.message).join("; ")}`,
    );
  }
  return categoryId;
}

export async function productHasWebpMedia(
  client: ShopifyClient,
  productId: string,
): Promise<boolean> {
  const query = `
    query ProductWebpMedia($id: ID!) {
      product(id: $id) {
        media(first: 50) {
          nodes {
            ... on MediaImage {
              mimeType
            }
          }
        }
      }
    }
  `;
  const data = (await client.graphql(query, { id: productId })) as {
    product: { media: { nodes: Array<{ mimeType?: string | null }> } } | null;
  };
  return Boolean(data.product?.media.nodes.some((node) => node.mimeType === "image/webp"));
}

export async function attachProductToManualCollections(input: {
  client: CollectionResolverClient;
  productId: string;
  collections: unknown;
}): Promise<string[]> {
  const collectionIds = await resolveManualCollectionIdsByTitlesOrHandles(
    input.client,
    input.collections,
  );
  if (collectionIds.length === 0) return [];

  const existingQuery = `
    query ProductCollections($id: ID!) {
      product(id: $id) {
        collections(first: 250) {
          nodes { id }
        }
      }
    }
  `;
  const existingData = (await input.client.graphql(existingQuery, { id: input.productId })) as {
    product: { collections: { nodes: Array<{ id: string }> } } | null;
  };
  const existingIds = new Set(existingData.product?.collections.nodes.map((node) => node.id) ?? []);
  const idsToAdd = collectionIds.filter((id) => !existingIds.has(id));
  if (idsToAdd.length === 0) return collectionIds;

  const mutation = `
    mutation AddProductToCollection($id: ID!, $productIds: [ID!]!) {
      collectionAddProducts(id: $id, productIds: $productIds) {
        userErrors { field message }
      }
    }
  `;
  for (const collectionId of idsToAdd) {
    const data = (await input.client.graphql(mutation, {
      id: collectionId,
      productIds: [input.productId],
    })) as {
      collectionAddProducts: {
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    };
    const errors = data.collectionAddProducts?.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(
        `Shopify collectionAddProducts failed: ${errors.map((error) => error.message).join("; ")}`,
      );
    }
  }

  return collectionIds;
}

/** Fetch every publication ID for the shop, following pagination. */
async function getAllPublicationIds(client: ShopifyClient): Promise<string[]> {
  const query = `
    query Publications($cursor: String) {
      publications(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id name }
      }
    }
  `;

  const ids: string[] = [];
  let cursor: string | null = null;
  // Bound the loop defensively; stores rarely have many publications.
  for (let page = 0; page < 20; page++) {
    const data = (await client.graphql(query, { cursor })) as {
      publications: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; name: string }>;
      };
    };
    for (const node of data.publications.nodes) ids.push(node.id);
    if (!data.publications.pageInfo.hasNextPage) break;
    cursor = data.publications.pageInfo.endCursor;
  }
  return ids;
}

/**
 * Publish the product to every active publication (sales channel).
 * Each channel is published independently — a failure on one channel logs and
 * continues so it never crashes the whole publish job. Product is already
 * ACTIVE via productSet, so this is best-effort.
 */
export async function publishToAllChannels(
  client: ShopifyClient,
  productId: string,
): Promise<ShopifyPublishChannelsResult> {
  const mutation = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `;

  let publicationIds: string[];
  try {
    publicationIds = await getAllPublicationIds(client);
  } catch (err) {
    // Likely missing read_publications scope — product is already ACTIVE.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Shopify] Could not list publications (non-fatal, product already ACTIVE):`,
      message,
    );
    return {
      attempted: 0,
      succeeded: 0,
      failed: [{ publicationId: "publications", message }],
    };
  }

  const failed: ShopifyPublishChannelsResult["failed"] = [];
  let succeeded = 0;

  for (const publicationId of publicationIds) {
    try {
      const data = (await client.graphql(mutation, {
        id: productId,
        input: [{ publicationId }],
      })) as { publishablePublish: { userErrors: Array<{ field: string; message: string }> } };
      const errors = data.publishablePublish?.userErrors ?? [];
      if (errors.length > 0) {
        console.warn(`[Shopify] publish to ${publicationId} userErrors (skip):`, errors);
        failed.push({
          publicationId,
          message: errors.map((error) => error.message).join("; "),
        });
        continue;
      }
      succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Shopify] publish to ${publicationId} failed (skip):`, message);
      failed.push({ publicationId, message });
    }
  }

  return {
    attempted: publicationIds.length,
    succeeded,
    failed,
  };
}

function toHandle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isExactCollectionMatch(collection: ShopifyCollectionNode, value: string, handle: string) {
  const normalizedValue = value.toLowerCase();
  return (
    collection.title.toLowerCase() === normalizedValue || collection.handle.toLowerCase() === handle
  );
}

function collectManualCollectionIds(
  names: string[],
  collections: ShopifyCollectionNode[],
  existingIds: Set<string>,
): string[] {
  const ids: string[] = [];

  for (const name of names) {
    const handle = toHandle(name);
    const exact = collections.find(
      (collection) =>
        collection.ruleSet === null && isExactCollectionMatch(collection, name, handle),
    );
    if (!exact || existingIds.has(exact.id)) continue;

    existingIds.add(exact.id);
    ids.push(exact.id);
  }

  return ids;
}

export async function resolveManualCollectionIdsByTitlesOrHandles(
  client: CollectionResolverClient,
  values: unknown,
): Promise<string[]> {
  const names = normalizeOrganizationCollections(values);
  if (names.length === 0) return [];

  try {
    const handleQuery = names.map((name) => `handle:${toHandle(name)}`).join(" OR ");
    const query = `
      query FindManualCollectionsByHandle($q: String!) {
        collections(first: 50, query: $q) {
          nodes {
            id
            title
            handle
            ruleSet { appliedDisjunctively }
          }
        }
      }
    `;
    const data = (await client.graphql(query, { q: handleQuery })) as {
      collections: { nodes: ShopifyCollectionNode[] };
    };

    const seenIds = new Set<string>();
    const ids = collectManualCollectionIds(names, data.collections.nodes, seenIds);
    const resolvedCount = ids.length;

    if (resolvedCount === names.length) return ids;

    const unresolvedNames = names.filter((name) => {
      const handle = toHandle(name);
      return !data.collections.nodes.some(
        (collection) =>
          collection.ruleSet === null && isExactCollectionMatch(collection, name, handle),
      );
    });

    if (unresolvedNames.length === 0) return ids;

    const allCollectionsQuery = `
      query ListManualCollectionsForTitleMatch {
        collections(first: 250) {
          nodes {
            id
            title
            handle
            ruleSet { appliedDisjunctively }
          }
        }
      }
    `;
    const allCollections = (await client.graphql(allCollectionsQuery, {})) as {
      collections: { nodes: ShopifyCollectionNode[] };
    };

    ids.push(
      ...collectManualCollectionIds(unresolvedNames, allCollections.collections.nodes, seenIds),
    );

    const finalUnresolved = names.filter((name) => {
      const handle = toHandle(name);
      const matchedInFirst = data.collections.nodes.some(
        (collection) =>
          collection.ruleSet === null && isExactCollectionMatch(collection, name, handle),
      );
      if (matchedInFirst) return false;

      const matchedInSecond = allCollections.collections.nodes.some(
        (collection) =>
          collection.ruleSet === null && isExactCollectionMatch(collection, name, handle),
      );
      return !matchedInSecond;
    });

    if (finalUnresolved.length > 0) {
      for (const name of finalUnresolved) {
        try {
          const createMutation = `
            mutation CreateManualCollection($input: CollectionInput!) {
              collectionCreate(input: $input) {
                collection {
                  id
                  title
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          const res = (await client.graphql(createMutation, {
            input: { title: name },
          })) as {
            collectionCreate?: {
              collection?: { id: string; title: string } | null;
              userErrors?: Array<{ field: string[]; message: string }> | null;
            } | null;
          };

          const collection = res.collectionCreate?.collection;
          const userErrors = res.collectionCreate?.userErrors || [];
          if (userErrors.length > 0) {
            console.error(`[Shopify] Failed to create collection "${name}":`, userErrors);
          } else if (collection?.id) {
            console.log(
              `[Shopify] Successfully auto-created collection "${name}" with ID ${collection.id}`,
            );
            if (!seenIds.has(collection.id)) {
              seenIds.add(collection.id);
              ids.push(collection.id);
            }
          }
        } catch (createErr) {
          console.error(`[Shopify] Error creating collection "${name}":`, createErr);
        }
      }
    }

    return ids;
  } catch (err) {
    console.warn(
      `[Shopify] Manual collection resolve failed, falling back to product type collections:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function resolveProductCollectionIds(
  client: CollectionResolverClient,
  canonicalType: string | null,
  organizationCollections: unknown = [],
): Promise<string[]> {
  const organizationCollectionIds = await resolveManualCollectionIdsByTitlesOrHandles(
    client,
    organizationCollections,
  );
  if (organizationCollectionIds.length > 0) return organizationCollectionIds;

  return resolveCollectionIds(client, canonicalType);
}

/**
 * Resolve manual collection IDs for the canonical product type by exact
 * title/handle match. Returns [] (omit) when no exact match.
 * Filters out Smart Collections (where ruleSet is not null).
 */
async function resolveCollectionIds(
  client: CollectionResolverClient,
  canonicalType: string | null,
): Promise<string[]> {
  if (!canonicalType) return [];
  const title = PRODUCT_TYPE_COLLECTION_MAP[canonicalType];
  if (!title) return [];

  const ids = await resolveManualCollectionIdsByTitlesOrHandles(client, [title]);
  if (ids.length > 0) return ids;
  if (canonicalType) {
    console.warn(`[Shopify] No exact manual collection for "${title}" — omitting collections`);
  }
  return [];
}

function extractNumericId(gid: string): string {
  // "gid://shopify/Product/123456" → "123456"
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}
