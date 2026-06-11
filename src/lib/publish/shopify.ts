/**
 * Shopify Publish — Create product via GraphQL Admin API
 *
 * Flow (API 2025-04+):
 * 1. productSet — atomic: title, bodyHtml, tags, productType, options, variants (status: ACTIVE)
 * 2. Upload mockup images via stagedUploadsCreate + productCreateMedia
 * 3. publishablePublish — ensure product visible on Online Store (graceful, non-fatal)
 */

import { ShopifyClient } from "@/lib/shopify/client";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { formatDescriptionHtml } from "@/lib/content/description-html";

export type ShopifyMockupImage =
  | { kind: "local"; path: string; colorName?: string }
  | { kind: "remote"; url: string; colorName?: string };

export interface ShopifyPublishInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  priceUsd: number;
  productType: string;
  colors: Array<{ name: string; hex: string }>;
  sizes?: string[]; // all sizes to create
  variants?: Array<{
    colorName: string;
    size: string;
    sku: string;
    price: number;
    printifyVariantId: string;
  }>;
  collections?: string[]; // matching collection IDs (if any)
  category?: string | null; // taxonomy category ID (if any)
  mockupPaths: string[]; // absolute file paths
  mockupImages?: ShopifyMockupImage[];
  existingProductId?: string | null; // for retry idempotency
}

export interface ShopifyPublishResult {
  shopifyProductId: string;
  shopifyVariantIds: string[];
  shopifyProductUrl: string;
  shopifyVariantsDetail?: Array<{
    id: string;
    colorName?: string;
    sizeName?: string;
  }>;
}

const TAXONOMY_CATEGORY_BY_TYPE = [
  {
    test: /\bhoodie(s)?\b/,
    id: "gid://shopify/TaxonomyCategory/aa-1-13-13",
  },
  {
    test: /\bsweatshirt(s)?\b/,
    id: "gid://shopify/TaxonomyCategory/aa-1-13-14",
  },
  {
    test: /\btank\s*top(s)?\b|\btank(s)?\b/,
    id: "gid://shopify/TaxonomyCategory/aa-1-13-9",
  },
  {
    test: /\bsweater(s)?\b|\bpullover(s)?\b/,
    id: "gid://shopify/TaxonomyCategory/aa-1-13-12",
  },
  {
    test: /\bt[\s-]?shirt(s)?\b|\btee(s)?\b/,
    id: "gid://shopify/TaxonomyCategory/aa-1-13-8",
  },
];

export function getTaxonomyCategoryId(productType?: string | null): string | null {
  const normalized = productType
    ?.toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return TAXONOMY_CATEGORY_BY_TYPE.find((entry) => entry.test.test(normalized))?.id ?? null;
}

const PRODUCT_TYPE_COLLECTION_MAP: Record<string, string> = {
  "T-Shirt": "T-Shirts",
  "T Shirt": "T-Shirts",
  "Tee": "T-Shirts",
  "Hoodie": "Hoodies",
  "Sweatshirt": "Sweatshirts",
  "Tank Top": "Tanks",
  "Tank": "Tanks",
  "Sweater": "Sweaters",
};

const DEFAULT_COLLECTION_NAME = "All Products";

export function getCollectionTitleForProductType(productType?: string | null): string {
  if (!productType) return DEFAULT_COLLECTION_NAME;
  const normalized = productType.trim().toLowerCase();
  
  for (const [key, val] of Object.entries(PRODUCT_TYPE_COLLECTION_MAP)) {
    if (normalized.includes(key.toLowerCase())) {
      return val;
    }
  }
  return DEFAULT_COLLECTION_NAME;
}

export async function findCollectionId(
  client: ShopifyClient,
  productType: string,
  isUpdate: boolean
): Promise<string[] | undefined> {
  const targetTitle = getCollectionTitleForProductType(productType);

  try {
    const searchRes = await client.graphql(`
      query searchCollection($query: String!) {
        collections(first: 5, query: $query) {
          nodes {
            id
            title
          }
        }
      }
    `, { query: `title:"${targetTitle}"` }) as any;

    const matchedNode = searchRes?.collections?.nodes?.find(
      (n: any) => n.title.toLowerCase() === targetTitle.toLowerCase()
    );

    if (matchedNode) {
      return [matchedNode.id];
    }

    if (targetTitle !== DEFAULT_COLLECTION_NAME) {
      console.log(`[Shopify] Collection "${targetTitle}" not found. Falling back to "${DEFAULT_COLLECTION_NAME}"...`);
      const fallbackRes = await client.graphql(`
        query searchFallback($query: String!) {
          collections(first: 5, query: $query) {
            nodes {
              id
              title
            }
          }
        }
      `, { query: `title:"${DEFAULT_COLLECTION_NAME}"` }) as any;

      const fallbackNode = fallbackRes?.collections?.nodes?.find(
        (n: any) => n.title.toLowerCase() === DEFAULT_COLLECTION_NAME.toLowerCase()
      );

      if (fallbackNode) {
        return [fallbackNode.id];
      }
    }

    console.warn(`[Shopify] No matching collection found for "${targetTitle}" or fallback "${DEFAULT_COLLECTION_NAME}"`);
    return undefined;
  } catch (err) {
    console.error(`[Shopify] findCollectionId failed:`, err);
    return undefined;
  }
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
  let variantNodes: Array<{ id: string; selectedOptions: Array<{ name: string; value: string }> }> = [];

  if (input.existingProductId) {
    // Product already created in a previous attempt — skip creation
    console.log(`[Shopify] Reusing existing product: ${input.existingProductId}`);
    productId = input.existingProductId;
    
    // Fetch variants from Shopify
    try {
      const query = `
        query getProductVariants($id: ID!) {
          product(id: $id) {
            variants(first: 100) {
              nodes {
                id
                selectedOptions { name value }
              }
            }
          }
        }
      `;
      const res = await client.graphql(query, { id: productId }) as any;
      variantNodes = res?.product?.variants?.nodes || [];
      variantIds = variantNodes.map(v => v.id);
    } catch (err) {
      console.warn(`[Shopify] Failed to fetch existing variants (non-fatal):`, err);
      variantIds = [];
    }
  } else {
    // Step 1: Create product + options + variants atomically
    const productResult = await createProductWithSet(client, input);
    productId = productResult.productId;
    variantNodes = productResult.variantNodes;
    variantIds = variantNodes.map(v => v.id);
  }

  // Step 2: Upload mockup images and link to variants
  if (input.mockupImages && input.mockupImages.length > 0) {
    const uploadedMedia = await uploadProductImages(client, productId, input.mockupImages);
    
    // Step 2.5: Link media to variants if we just created them
    if (uploadedMedia.length > 0 && variantNodes.length > 0) {
      const variantMediaPairs: Array<{ id: string, mediaId: string }> = [];
      
      for (const vNode of variantNodes) {
        const colorOption = vNode.selectedOptions.find(o => o.name === "Color");
        if (colorOption) {
          const matchingMedia = uploadedMedia.find(m => m.colorName && m.colorName.toLowerCase() === colorOption.value.toLowerCase());
          if (matchingMedia) {
            variantMediaPairs.push({
              id: vNode.id,
              mediaId: matchingMedia.mediaId
            });
          }
        }
      }

      if (variantMediaPairs.length > 0) {
        const bulkUpdateMutation = `
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `;
        const bulkUpdateRes = await client.graphql(bulkUpdateMutation, {
          productId,
          variants: variantMediaPairs.map(v => ({ id: v.id, mediaId: v.mediaId }))
        }) as any;

        if (bulkUpdateRes.productVariantsBulkUpdate?.userErrors?.length > 0) {
          console.warn(`[Shopify] productVariantsBulkUpdate failed (non-fatal):`, bulkUpdateRes.productVariantsBulkUpdate.userErrors);
        }
      }
    }

    // Step 2.6: Reorder media so that the Primary Color's first image is at position 0 (thumbnail)
    const primaryColorName = input.mockupImages[0]?.colorName;
    if (primaryColorName && uploadedMedia.length > 0) {
      const primaryMedia = uploadedMedia.find(m => m.colorName === primaryColorName);
      if (primaryMedia) {
        const reorderMutation = `
          mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
            productReorderMedia(id: $id, moves: $moves) {
              userErrors { field message }
            }
          }
        `;
        try {
          const reorderRes = await client.graphql(reorderMutation, {
            id: productId,
            moves: [{ id: primaryMedia.mediaId, newPosition: "0" }]
          }) as any;

          if (reorderRes.productReorderMedia?.userErrors?.length > 0) {
            console.warn(`[Shopify] productReorderMedia failed (non-fatal):`, reorderRes.productReorderMedia.userErrors);
          } else {
            console.log(`[Shopify] Reordered media: moved ${primaryMedia.mediaId} (color: ${primaryColorName}) to position 0`);
          }
        } catch (err) {
          console.warn(`[Shopify] productReorderMedia threw error (non-fatal):`, err);
        }
      }
    }
  } else if (input.mockupPaths.length > 0) {
    // Fallback for older code
    await uploadProductImages(client, productId, input.mockupPaths.map(p => ({ kind: "local", path: p })));
  }

  // Step 3: Publish to Online Store and all channels (graceful — non-fatal if scope missing)
  try {
    await publishProduct(client, productId);
  } catch (err) {
    // If read_publications scope not yet added, product is already ACTIVE via productSet
    console.warn(
      `[Shopify] publishablePublish failed (non-fatal, product already ACTIVE):`,
      err instanceof Error ? err.message : err,
    );
  }

  const variantDetails = variantNodes.map((v) => {
    const colorOpt = v.selectedOptions.find((o) => o.name === "Color")?.value;
    const sizeOpt = v.selectedOptions.find((o) => o.name === "Size")?.value;
    return {
      id: v.id,
      colorName: colorOpt,
      sizeName: sizeOpt,
    };
  });

  return {
    shopifyProductId: productId,
    shopifyVariantIds: variantIds,
    shopifyProductUrl: `https://${domain}/admin/products/${extractNumericId(productId)}`,
    shopifyVariantsDetail: variantDetails,
  };
}

/**
 * Create product using productSet mutation (API 2025-04+)
 * Sets status: ACTIVE so product is immediately visible without needing publishablePublish
 */
async function createProductWithSet(
  client: ShopifyClient,
  input: ShopifyPublishInput,
): Promise<{ productId: string; variantNodes: Array<{ id: string; selectedOptions: Array<{ name: string; value: string }> }> }> {
  const mutation = `
    mutation productSet($synchronous: Boolean!, $productSet: ProductSetInput!) {
      productSet(synchronous: $synchronous, input: $productSet) {
        product {
          id
          variants(first: 100) {
            nodes {
              id
              selectedOptions { name value }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const hasColors = input.colors.length > 0;
  const hasSizes = input.sizes && input.sizes.length > 0;

  const productOptions: any[] = [];
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
      values: input.sizes!.map((s) => ({ name: s })),
    });
  }

  let variants: any[] = [];
  if (input.variants && input.variants.length > 0) {
    variants = input.variants.map((v) => {
      const optionValues: any[] = [];
      if (hasColors) {
        optionValues.push({ optionName: "Color", name: v.colorName });
      }
      if (hasSizes) {
        optionValues.push({ optionName: "Size", name: v.size });
      }
      return {
        optionValues,
        price: v.price,
        sku: v.sku,
        inventoryPolicy: "CONTINUE", // Continue selling even if 0 stock
      };
    });
  } else {
    // Fallback to legacy behavior if no sizes provided
    variants = hasColors
      ? input.colors.map((c) => ({
          optionValues: [{ optionName: "Color", name: c.name }],
          price: input.priceUsd,
          inventoryPolicy: "CONTINUE",
        }))
      : [{ price: input.priceUsd, inventoryPolicy: "CONTINUE" }];
  }

  // Get dynamic collections if not already passed
  let finalCollections = input.collections;
  if (finalCollections === undefined) {
    finalCollections = await findCollectionId(client, input.productType, false);
  }

  // Get dynamic category if not already passed
  const finalCategory = input.category !== undefined ? input.category : getTaxonomyCategoryId(input.productType);

  const variables = {
    synchronous: true,
    productSet: {
      title: input.title,
      descriptionHtml: formatDescriptionHtml(input.descriptionHtml),
      tags: input.tags,
      productType: input.productType,
      status: "ACTIVE", // Publish immediately
      category: finalCategory,
      ...(finalCollections !== undefined ? { collections: finalCollections } : {}),
      productOptions,
      variants,
    },
  };

  const data = await client.graphql(mutation, variables) as {
    productSet: {
      product: {
        id: string;
        variants: {
          nodes: Array<{ id: string; selectedOptions: Array<{ name: string; value: string }> }>;
        };
      };
      userErrors: Array<{ field: string; message: string }>;
    };
  };

  if (data.productSet.userErrors.length > 0) {
    throw new Error(
      `Shopify productSet failed: ${data.productSet.userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  return {
    productId: data.productSet.product.id,
    variantNodes: data.productSet.product.variants.nodes,
  };
}

async function uploadProductImages(
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

  const mediaResult = await client.graphql(mediaMutation, {
    productId,
    media: mediaSources.map((source) => ({
      originalSource: source.originalSource,
      mediaContentType: "IMAGE",
    })),
  }) as {
    productCreateMedia: {
      media: Array<{ id: string }>;
      mediaUserErrors: Array<{ field: string; message: string }>;
    };
  };

  if (mediaResult.productCreateMedia.mediaUserErrors.length > 0) {
    throw new Error(`Shopify productCreateMedia failed: ${mediaResult.productCreateMedia.mediaUserErrors.map((e) => e.message).join("; ")}`);
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
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return { mime: "image/png", ext: ".png" };
    }
    // JPEG: FF D8 FF
    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
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
      buffer[11] === 0x50    // P
    ) {
      return { mime: "image/webp", ext: ".webp" };
    }
    // GIF: 47 49 46 38
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
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

  const stagedData = await client.graphql(stagesMutation, { input: stagedInput }) as {
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

async function publishProduct(client: ShopifyClient, productId: string): Promise<void> {
  const mutation = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `;

  let pubIds = await getAllPublicationIds(client);
  if (pubIds.length === 0) {
    try {
      const fallbackId = await getOnlineStorePublicationId(client);
      pubIds = [fallbackId];
    } catch (err) {
      console.warn("[Shopify] Failed to get fallback Online Store publication ID:", err);
    }
  }

  console.log(`[Shopify] Publishing product ${productId} to ${pubIds.length} publications...`);

  for (const pubId of pubIds) {
    try {
      const res = await client.graphql(mutation, {
        id: productId,
        input: [{ publicationId: pubId }]
      }) as any;

      const userErrors = res?.publishablePublish?.userErrors || [];
      if (userErrors.length > 0) {
        console.warn(`[Shopify] Failed to publish product ${productId} to publication ${pubId} (userErrors):`, userErrors);
      } else {
        console.log(`[Shopify] Successfully published product ${productId} to publication ${pubId}`);
      }
    } catch (err) {
      console.warn(`[Shopify] Error publishing product ${productId} to publication ${pubId}:`, err);
    }
  }
}

async function getAllPublicationIds(client: ShopifyClient): Promise<string[]> {
  const ids: string[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const query = `
      query getPublications($first: Int!, $after: String) {
        publications(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
            }
          }
        }
      }
    `;

    try {
      const data = await client.graphql(query, { first: 50, after: cursor }) as any;
      const nodes = data?.publications?.edges || [];
      for (const edge of nodes) {
        if (edge.node?.id) {
          ids.push(edge.node.id);
        }
      }

      hasNextPage = data?.publications?.pageInfo?.hasNextPage || false;
      cursor = data?.publications?.pageInfo?.endCursor || null;
    } catch (err) {
      console.warn("[Shopify] Failed to fetch page of publications:", err);
      break;
    }
  }

  return ids;
}

async function getOnlineStorePublicationId(client: ShopifyClient): Promise<string> {
  const query = `
    query {
      publications(first: 10) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;

  const data = await client.graphql(query) as {
    publications: { edges: Array<{ node: { id: string; name: string } }> };
  };

  // Find "Online Store" publication
  const onlineStore = data.publications.edges.find(
    (e) => e.node.name === "Online Store",
  );

  if (!onlineStore) {
    if (data.publications.edges.length > 0) {
      return data.publications.edges[0].node.id;
    }
    throw new Error("No publications found for this shop");
  }

  return onlineStore.node.id;
}

function extractNumericId(gid: string): string {
  // "gid://shopify/Product/123456" → "123456"
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}
