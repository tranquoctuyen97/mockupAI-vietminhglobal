/**
 * Shopify Publish — Create product via GraphQL Admin API
 *
 * Flow:
 * 1. productCreate — title, bodyHtml, tags, vendor, productType
 * 2. productVariantsBulkCreate — color variants with prices
 * 3. Upload mockup images via stagedUploadsCreate + productCreateMedia
 * 4. publishablePublish — make product visible
 */

import { ShopifyClient } from "@/lib/shopify/client";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface ShopifyPublishInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  priceUsd: number;
  productType: string;
  colors: Array<{ name: string; hex: string }>;
  mockupPaths: string[]; // absolute file paths
}

export interface ShopifyPublishResult {
  shopifyProductId: string;
  shopifyVariantIds: string[];
  shopifyProductUrl: string;
}

/**
 * Extend ShopifyClient for publish operations
 */
export async function publishToShopify(
  client: ShopifyClient,
  domain: string,
  input: ShopifyPublishInput,
): Promise<ShopifyPublishResult> {
  // Step 1: Create product with initial option and variant
  const productCreateResult = await createProduct(client, input);

  // Step 2: Create additional color variants if more than 1 color
  let variantIds = [productCreateResult.initialVariantId];
  if (input.colors.length > 1) {
    const additionalVariants = await createVariants(
      client,
      productCreateResult.productId,
      input.colors.slice(1),
      input.priceUsd,
    );
    variantIds = [...variantIds, ...additionalVariants];
  }

  // Step 3: Upload mockup images
  if (input.mockupPaths.length > 0) {
    await uploadProductImages(client, productCreateResult.productId, input.mockupPaths);
  }

  // Step 4: Publish the product
  await publishProduct(client, productCreateResult.productId);

  return {
    shopifyProductId: productCreateResult.productId,
    shopifyVariantIds: variantIds,
    shopifyProductUrl: `https://${domain}/admin/products/${extractNumericId(productCreateResult.productId)}`,
  };
}

async function createProduct(
  client: ShopifyClient,
  input: ShopifyPublishInput,
): Promise<{ productId: string; initialVariantId: string }> {
  const mutation = `
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          variants(first: 1) {
            edges {
              node { id }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    product: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      tags: input.tags,
      productType: input.productType,
      options: input.colors.length > 0 ? ["Color"] : undefined,
      variants: input.colors.length > 0
        ? [
            {
              optionValues: [{ optionName: "Color", name: input.colors[0].name }],
              price: input.priceUsd.toFixed(2),
            },
          ]
        : [{ price: input.priceUsd.toFixed(2) }],
    },
  };

  const data = await client.graphql(mutation, variables) as {
    productCreate: {
      product: { id: string; variants: { edges: Array<{ node: { id: string } }> } };
      userErrors: Array<{ field: string; message: string }>;
    };
  };

  if (data.productCreate.userErrors.length > 0) {
    throw new Error(
      `Shopify productCreate failed: ${data.productCreate.userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  return {
    productId: data.productCreate.product.id,
    initialVariantId: data.productCreate.product.variants.edges[0]?.node.id || "",
  };
}

async function createVariants(
  client: ShopifyClient,
  productId: string,
  colors: Array<{ name: string }>,
  price: number,
): Promise<string[]> {
  const mutation = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    productId,
    variants: colors.map((c) => ({
      optionValues: [{ optionName: "Color", name: c.name }],
      price: price.toFixed(2),
    })),
  };

  const data = await client.graphql(mutation, variables) as {
    productVariantsBulkCreate: {
      productVariants: Array<{ id: string }>;
      userErrors: Array<{ field: string; message: string }>;
    };
  };

  if (data.productVariantsBulkCreate.userErrors.length > 0) {
    console.error("[Shopify] Variant creation warnings:", data.productVariantsBulkCreate.userErrors);
  }

  return data.productVariantsBulkCreate.productVariants.map((v) => v.id);
}

async function uploadProductImages(
  client: ShopifyClient,
  productId: string,
  mockupPaths: string[],
): Promise<void> {
  // Step 1: Create staged uploads
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

  const stagedInput = mockupPaths.map((p) => ({
    filename: basename(p),
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

  // Step 2: Upload files to staged URLs
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const filePath = mockupPaths[i];
    const fileBuffer = await readFile(filePath);

    await fetch(target.url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: fileBuffer,
    });
  }

  // Step 3: Attach uploaded images to product
  const mediaMutation = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }
  `;

  const mediaInput = targets.map((t) => ({
    originalSource: t.resourceUrl,
    mediaContentType: "IMAGE",
  }));

  await client.graphql(mediaMutation, {
    productId,
    media: mediaInput,
  });
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
