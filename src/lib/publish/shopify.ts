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
import { basename } from "node:path";

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
  mockupPaths: string[]; // absolute file paths
  mockupImages?: ShopifyMockupImage[];
  existingProductId?: string | null; // for retry idempotency
}

export interface ShopifyPublishResult {
  shopifyProductId: string;
  shopifyVariantIds: string[];
  shopifyProductUrl: string;
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
    variantIds = []; // variants already exist
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
  } else if (input.mockupPaths.length > 0) {
    // Fallback for older code
    await uploadProductImages(client, productId, input.mockupPaths.map(p => ({ kind: "local", path: p })));
  }

  // Step 3: Publish to Online Store (graceful — non-fatal if scope missing)
  try {
    await publishProduct(client, productId);
  } catch (err) {
    // If read_publications scope not yet added, product is already ACTIVE via productSet
    console.warn(
      `[Shopify] publishablePublish failed (non-fatal, product already ACTIVE):`,
      err instanceof Error ? err.message : err,
    );
  }

  return {
    shopifyProductId: productId,
    shopifyVariantIds: variantIds,
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

  const variables = {
    synchronous: true,
    productSet: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      tags: input.tags,
      productType: input.productType,
      status: "ACTIVE", // Publish immediately — no need for separate publishablePublish
      productOptions: hasColors
        ? [
            {
              name: "Color",
              position: 1,
              values: input.colors.map((c) => ({ name: c.name })),
            },
          ]
        : [],
      variants: hasColors
        ? input.colors.map((c) => ({
            optionValues: [{ optionName: "Color", name: c.name }],
            price: input.priceUsd,
          }))
        : [{ price: input.priceUsd }],
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

async function stageLocalProductImages(
  client: ShopifyClient,
  localImages: Array<Extract<ShopifyMockupImage, { kind: "local" }>>,
): Promise<Array<{ originalSource: string; colorName?: string }>> {
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

  const stagedInput = localImages.map((img) => ({
    filename: basename(img.path),
    mimeType: "image/png",
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

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const fileBuffer = await readFile(localImages[i].path);

    await fetch(target.url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: fileBuffer,
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

  // Publish to online store
  await client.graphql(mutation, {
    id: productId,
    input: [{ publicationId: await getOnlineStorePublicationId(client) }],
  });
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
    // Use first publication as fallback
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
