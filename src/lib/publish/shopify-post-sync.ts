import type { EnabledPrintifyVariantMatrixRow } from "@/lib/printify/product-matrix";
import type { ShopifyClient } from "@/lib/shopify/client";

import {
  orderOptionValuesByPrimary,
  reorderPrimaryMedia,
  type ShopifyMockupImage,
  uploadProductImages,
} from "./shopify";

type ShopifyGraphqlClient = Pick<ShopifyClient, "graphql">;

type ShopifyProductOption = {
  id: string;
  name: string;
  position: number;
  values?: string[];
  optionValues?: Array<{ id: string; name: string; hasVariants?: boolean }>;
};

type ShopifyProductMediaNode = {
  id: string;
  alt?: string | null;
  preview?: { image?: { url?: string | null; originalSrc?: string | null } | null } | null;
};

type ShopifyProductVariantNode = {
  id: string;
  sku: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  media?: { nodes: ShopifyProductMediaNode[] };
};

type ShopifyPostSyncProduct = {
  id: string;
  options: ShopifyProductOption[];
  media: { nodes: ShopifyProductMediaNode[] };
  variants: {
    nodes: ShopifyProductVariantNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type ShopifyMediaVariantTarget = {
  shopifyVariantId: string;
  sku: string;
  colorName: string;
};

export type ShopifyPostSyncResult = {
  repairedOptions: boolean;
  uploadedMediaCount: number;
  attachedVariantCount: number;
  primaryMediaId: string | null;
  reorderedGallery: boolean;
};

type SemanticOptions = {
  colorOption: ShopifyProductOption;
  sizeOption: ShopifyProductOption | null;
};

const TEMP_SIZE_OPTION_NAME = "__mockupai_size_tmp__";
const APPAREL_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];

export async function repairAndVerifyShopifyPostSync(input: {
  client: ShopifyGraphqlClient;
  productId: string;
  printifyRows: EnabledPrintifyVariantMatrixRow[];
  mockupImages: ShopifyMockupImage[];
  primaryColorName: string | null;
  sizesInOrder?: string[];
}): Promise<ShopifyPostSyncResult> {
  const expectedBySku = buildExpectedBySku(input.printifyRows);
  let product = await fetchShopifyPostSyncProduct(input.client, input.productId);
  const semantic = inferSemanticOptions(product, expectedBySku);
  const orderedColors = orderValuesByPrimary(
    uniqueInOrder(input.printifyRows.map((row) => row.colorName)),
    input.primaryColorName,
  );
  const orderedSizes = orderSizeValues(
    input.sizesInOrder?.length
      ? input.sizesInOrder
      : uniqueInOrder(input.printifyRows.map((row) => row.size)),
  );

  const repairedOptions = await repairShopifyOptionSemantics({
    client: input.client,
    productId: input.productId,
    options: product.options,
    semantic,
    orderedColors,
    orderedSizes,
  });

  if (repairedOptions) {
    product = await fetchShopifyPostSyncProduct(input.client, input.productId);
  }

  assertShopifyOptions(product, orderedColors, orderedSizes);

  const mediaResult = await syncShopifyVariantMedia({
    client: input.client,
    product,
    productId: input.productId,
    mockupImages: input.mockupImages,
    targets: input.printifyRows.map((row) => {
      const variant = product.variants.nodes.find((node) => node.sku?.trim() === row.sku);
      if (!variant) {
        throw new Error(`Missing Shopify variant for SKU ${row.sku}`);
      }
      return {
        shopifyVariantId: variant.id,
        sku: row.sku,
        colorName: row.colorName,
      };
    }),
    primaryColorName: input.primaryColorName,
  });

  product = await fetchShopifyPostSyncProduct(input.client, input.productId);
  assertShopifyVariantMedia(product, expectedBySku);
  const reorderedGallery = await reorderShopifyMediaGallery({
    client: input.client,
    productId: input.productId,
    product,
    orderedColors,
  });
  product = await waitForShopifyMediaGalleryOrder({
    client: input.client,
    productId: input.productId,
    orderedColors,
  });
  assertShopifyMediaGallery(product, orderedColors);

  return {
    repairedOptions,
    uploadedMediaCount: mediaResult.uploadedMediaCount,
    attachedVariantCount: mediaResult.attachedVariantCount,
    primaryMediaId: mediaResult.primaryMediaId,
    reorderedGallery,
  };
}

async function fetchShopifyPostSyncProduct(
  client: ShopifyGraphqlClient,
  productId: string,
): Promise<ShopifyPostSyncProduct> {
  const query = `
    query ProductPostSyncState($id: ID!, $first: Int!, $after: String) {
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
        media(first: 100) {
          nodes {
            id
            alt
            ... on MediaImage {
              preview {
                image {
                  url
                  originalSrc
                }
              }
            }
          }
        }
        variants(first: $first, after: $after) {
          nodes {
            id
            sku
            selectedOptions { name value }
            media(first: 10) {
              nodes {
                id
                alt
                ... on MediaImage {
                  preview {
                    image {
                      url
                      originalSrc
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  const variants: ShopifyProductVariantNode[] = [];
  let productBase: Omit<ShopifyPostSyncProduct, "variants"> | null = null;
  let after: string | null = null;

  do {
    const data = (await client.graphql(query, {
      id: productId,
      first: 100,
      after,
    })) as { product: ShopifyPostSyncProduct | null };

    if (!data.product) throw new Error(`Shopify product not found: ${productId}`);
    productBase = {
      id: data.product.id,
      options: data.product.options,
      media: data.product.media,
    };
    variants.push(...data.product.variants.nodes);
    after = data.product.variants.pageInfo.hasNextPage
      ? data.product.variants.pageInfo.endCursor
      : null;
  } while (after);

  return {
    ...productBase,
    variants: {
      nodes: variants,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function buildExpectedBySku(rows: EnabledPrintifyVariantMatrixRow[]): Map<string, EnabledPrintifyVariantMatrixRow> {
  const expected = new Map<string, EnabledPrintifyVariantMatrixRow>();
  for (const row of rows) {
    const sku = row.sku.trim();
    if (!sku) throw new Error(`Missing SKU for Printify variant ${row.printifyVariantId}`);
    if (expected.has(sku)) throw new Error(`Duplicate Printify SKU in canonical rows: ${sku}`);
    expected.set(sku, row);
  }
  return expected;
}

function inferSemanticOptions(
  product: ShopifyPostSyncProduct,
  expectedBySku: Map<string, EnabledPrintifyVariantMatrixRow>,
): SemanticOptions {
  const matches = product.options.map((option) => {
    let colorMatches = 0;
    let sizeMatches = 0;
    for (const variant of product.variants.nodes) {
      const expected = variant.sku ? expectedBySku.get(variant.sku.trim()) : null;
      if (!expected) continue;
      const selected = variant.selectedOptions.find((entry) => entry.name === option.name);
      if (!selected) continue;
      if (sameValue(selected.value, expected.colorName)) colorMatches += 1;
      if (sameValue(selected.value, expected.size)) sizeMatches += 1;
    }
    return { option, colorMatches, sizeMatches };
  });

  const colorOption = matches
    .filter((match) => match.colorMatches > 0)
    .sort((a, b) => b.colorMatches - a.colorMatches)[0];
  const sizeOption = matches
    .filter((match) => match.sizeMatches > 0)
    .sort((a, b) => b.sizeMatches - a.sizeMatches)[0];

  if (!colorOption || colorOption.colorMatches !== expectedBySku.size) {
    throw new Error("Cannot infer Shopify Color option from synced SKUs");
  }

  if (sizeOption && sizeOption.sizeMatches !== expectedBySku.size) {
    throw new Error("Cannot infer Shopify Size option from synced SKUs");
  }

  if (sizeOption && colorOption.option.id === sizeOption.option.id) {
    throw new Error("Cannot infer distinct Shopify Color and Size options");
  }

  return {
    colorOption: colorOption.option,
    sizeOption: sizeOption?.option ?? null,
  };
}

async function repairShopifyOptionSemantics(input: {
  client: ShopifyGraphqlClient;
  productId: string;
  options: ShopifyProductOption[];
  semantic: SemanticOptions;
  orderedColors: string[];
  orderedSizes: string[];
}): Promise<boolean> {
  let changed = false;
  const colorNameWrong = normalize(input.semantic.colorOption.name) !== "color";
  const sizeNameWrong =
    input.semantic.sizeOption && normalize(input.semantic.sizeOption.name) !== "size";

  if (sizeNameWrong && normalize(input.semantic.sizeOption!.name) === "color") {
    await updateProductOptionName({
      client: input.client,
      productId: input.productId,
      optionId: input.semantic.sizeOption!.id,
      name: TEMP_SIZE_OPTION_NAME,
    });
    changed = true;
  }

  if (colorNameWrong) {
    await updateProductOptionName({
      client: input.client,
      productId: input.productId,
      optionId: input.semantic.colorOption.id,
      name: "Color",
    });
    changed = true;
  }

  if (input.semantic.sizeOption && normalize(input.semantic.sizeOption.name) !== "size") {
    await updateProductOptionName({
      client: input.client,
      productId: input.productId,
      optionId: input.semantic.sizeOption.id,
      name: "Size",
    });
    changed = true;
  }

  const reorderChanged =
    input.semantic.colorOption.position !== 1 ||
    (input.semantic.sizeOption && input.semantic.sizeOption.position !== 2) ||
    !sameOrderedValues(optionValueNames(input.semantic.colorOption), input.orderedColors) ||
    (input.semantic.sizeOption
      ? !sameOrderedValues(optionValueNames(input.semantic.sizeOption), input.orderedSizes)
      : false);

  if (reorderChanged || changed) {
    await reorderProductOptions({
      client: input.client,
      productId: input.productId,
      options: [
        { name: "Color", values: input.orderedColors },
        ...(input.semantic.sizeOption ? [{ name: "Size", values: input.orderedSizes }] : []),
      ],
    });
    changed = true;
  }

  return changed;
}

async function updateProductOptionName(input: {
  client: ShopifyGraphqlClient;
  productId: string;
  optionId: string;
  name: string;
}): Promise<void> {
  const mutation = `
    mutation UpdateProductOptionName($productId: ID!, $option: OptionUpdateInput!) {
      productOptionUpdate(productId: $productId, option: $option) {
        userErrors { field message code }
      }
    }
  `;
  const data = (await input.client.graphql(mutation, {
    productId: input.productId,
    option: {
      id: input.optionId,
      name: input.name,
    },
  })) as {
    productOptionUpdate: {
      userErrors: Array<{ field?: string | string[] | null; message: string; code?: string | null }>;
    };
  };
  assertNoUserErrors("Shopify productOptionUpdate", data.productOptionUpdate.userErrors);
}

async function reorderProductOptions(input: {
  client: ShopifyGraphqlClient;
  productId: string;
  options: Array<{ name: string; values?: string[] }>;
}): Promise<void> {
  const mutation = `
    mutation ReorderProductOptions($productId: ID!, $options: [OptionReorderInput!]!) {
      productOptionsReorder(productId: $productId, options: $options) {
        userErrors { field message code }
      }
    }
  `;
  const data = (await input.client.graphql(mutation, {
    productId: input.productId,
    options: input.options.map((option) => ({
      name: option.name,
      ...(option.values ? { values: option.values.map((name) => ({ name })) } : {}),
    })),
  })) as {
    productOptionsReorder: {
      userErrors: Array<{ field?: string | string[] | null; message: string; code?: string | null }>;
    };
  };
  assertNoUserErrors("Shopify productOptionsReorder", data.productOptionsReorder.userErrors);
}

async function syncShopifyVariantMedia(input: {
  client: ShopifyGraphqlClient;
  product: ShopifyPostSyncProduct;
  productId: string;
  mockupImages: ShopifyMockupImage[];
  targets: ShopifyMediaVariantTarget[];
  primaryColorName: string | null;
}): Promise<{ uploadedMediaCount: number; attachedVariantCount: number; primaryMediaId: string | null }> {
  const mediaByColor = mapExistingMediaByColor(input.product, input.targets);
  const missingColors = uniqueInOrder(input.targets.map((target) => target.colorName))
    .filter((colorName) => !mediaByColor.has(normalize(colorName)));

  let uploadedMediaCount = 0;
  if (missingColors.length > 0) {
    const uploads = input.mockupImages.filter((image) =>
      image.colorName ? missingColors.some((color) => sameValue(color, image.colorName!)) : false,
    );
    const uploaded = await uploadProductImages(input.client as ShopifyClient, input.productId, uploads);
    uploadedMediaCount = uploaded.length;
    for (const media of uploaded) {
      if (media.colorName) mediaByColor.set(normalize(media.colorName), media.mediaId);
    }
  }

  const updates = input.targets
    .map((target) => ({
      id: target.shopifyVariantId,
      mediaId: mediaByColor.get(normalize(target.colorName)),
    }))
    .filter((update): update is { id: string; mediaId: string } => Boolean(update.mediaId));

  if (updates.length !== input.targets.length) {
    const missing = input.targets
      .filter((target) => !mediaByColor.has(normalize(target.colorName)))
      .map((target) => target.colorName);
    throw new Error(`Missing Shopify media for colors: ${uniqueInOrder(missing).join(", ")}`);
  }

  const mutation = `
    mutation AttachVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `;
  const data = (await input.client.graphql(mutation, {
    productId: input.productId,
    variants: updates,
  })) as {
    productVariantsBulkUpdate: {
      userErrors: Array<{ field?: string | string[] | null; message: string }>;
    };
  };
  assertNoUserErrors("Shopify productVariantsBulkUpdate", data.productVariantsBulkUpdate.userErrors);

  const primaryMediaId = input.primaryColorName
    ? (mediaByColor.get(normalize(input.primaryColorName)) ?? null)
    : null;
  if (primaryMediaId) {
    await reorderPrimaryMedia(input.client as ShopifyClient, input.productId, primaryMediaId);
  }

  return {
    uploadedMediaCount,
    attachedVariantCount: updates.length,
    primaryMediaId,
  };
}

async function reorderShopifyMediaGallery(input: {
  client: ShopifyGraphqlClient;
  productId: string;
  product: ShopifyPostSyncProduct;
  orderedColors: string[];
}): Promise<boolean> {
  const mediaIdByColor = mediaIdByColorFromVariants(input.product);
  const orderedMediaIds = input.orderedColors.map((color) => {
    const mediaId = mediaIdByColor.get(normalize(color));
    if (!mediaId) throw new Error(`Missing Shopify gallery media for color ${color}`);
    return mediaId;
  });
  const currentMediaIds = input.product.media.nodes.map((media) => media.id);
  const alreadyOrdered = orderedMediaIds.every((mediaId, index) => currentMediaIds[index] === mediaId);
  if (alreadyOrdered) return false;

  const mutation = `
    mutation ReorderProductMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        job { id }
        userErrors { field message }
      }
    }
  `;
  const data = (await input.client.graphql(mutation, {
    id: input.productId,
    moves: orderedMediaIds.map((id, index) => ({ id, newPosition: String(index) })),
  })) as {
    productReorderMedia: {
      userErrors: Array<{ field?: string | string[] | null; message: string }>;
    };
  };
  assertNoUserErrors("Shopify productReorderMedia", data.productReorderMedia.userErrors);
  return true;
}

async function waitForShopifyMediaGalleryOrder(input: {
  client: ShopifyGraphqlClient;
  productId: string;
  orderedColors: string[];
}): Promise<ShopifyPostSyncProduct> {
  let product = await fetchShopifyPostSyncProduct(input.client, input.productId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (shopifyMediaGalleryMatches(product, input.orderedColors)) return product;
    await delay(500);
    product = await fetchShopifyPostSyncProduct(input.client, input.productId);
  }
  return product;
}

function assertShopifyMediaGallery(product: ShopifyPostSyncProduct, orderedColors: string[]): void {
  const actual = mediaGalleryColorOrder(product, orderedColors.length);
  if (!sameOrderedValues(actual, orderedColors)) {
    throw new Error(
      `Shopify media gallery order mismatch: expected ${orderedColors.join(", ")}, got ${actual.join(", ")}`,
    );
  }
}

function shopifyMediaGalleryMatches(product: ShopifyPostSyncProduct, orderedColors: string[]): boolean {
  return sameOrderedValues(mediaGalleryColorOrder(product, orderedColors.length), orderedColors);
}

function mediaGalleryColorOrder(product: ShopifyPostSyncProduct, count: number): string[] {
  const colorByMediaId = new Map<string, string>();
  for (const variant of product.variants.nodes) {
    const color = selectedOptionValue(variant, "Color");
    const mediaId = variant.media?.nodes?.[0]?.id ?? null;
    if (color && mediaId && !colorByMediaId.has(mediaId)) colorByMediaId.set(mediaId, color);
  }
  return product.media.nodes.slice(0, count).map((media) => colorByMediaId.get(media.id) ?? "");
}

function mediaIdByColorFromVariants(product: ShopifyPostSyncProduct): Map<string, string> {
  const out = new Map<string, string>();
  for (const variant of product.variants.nodes) {
    const color = selectedOptionValue(variant, "Color");
    const mediaId = variant.media?.nodes?.[0]?.id ?? null;
    if (color && mediaId && !out.has(normalize(color))) out.set(normalize(color), mediaId);
  }
  return out;
}

function mapExistingMediaByColor(
  product: ShopifyPostSyncProduct,
  targets: ShopifyMediaVariantTarget[],
): Map<string, string> {
  const colorByVariantId = new Map(targets.map((target) => [target.shopifyVariantId, target.colorName]));
  const out = new Map<string, string>();

  for (const variant of product.variants.nodes) {
    const colorName = colorByVariantId.get(variant.id);
    if (!colorName) continue;
    const mediaId = variant.media?.nodes?.[0]?.id;
    if (mediaId) out.set(normalize(colorName), mediaId);
  }

  for (const media of product.media.nodes) {
    const markerColor = extractMockupAiColor(media.alt);
    if (markerColor && !out.has(normalize(markerColor))) {
      out.set(normalize(markerColor), media.id);
    }
  }

  return out;
}

function assertShopifyOptions(
  product: ShopifyPostSyncProduct,
  orderedColors: string[],
  orderedSizes: string[],
): void {
  const options = [...product.options].sort((a, b) => a.position - b.position);
  const color = options[0];
  const size = options[1] ?? null;
  if (!color || normalize(color.name) !== "color") {
    throw new Error("Shopify option 1 must be Color");
  }
  if (!sameOrderedValues(optionValueNames(color), orderedColors)) {
    throw new Error(
      `Shopify Color values mismatch: expected ${orderedColors.join(", ")}, got ${optionValueNames(color).join(", ")}`,
    );
  }
  if (orderedSizes.length > 0) {
    if (!size || normalize(size.name) !== "size") {
      throw new Error("Shopify option 2 must be Size");
    }
    if (!sameOrderedValues(optionValueNames(size), orderedSizes)) {
      throw new Error(
        `Shopify Size values mismatch: expected ${orderedSizes.join(", ")}, got ${optionValueNames(size).join(", ")}`,
      );
    }
  }
}

function assertShopifyVariantMedia(
  product: ShopifyPostSyncProduct,
  expectedBySku: Map<string, EnabledPrintifyVariantMatrixRow>,
): void {
  const mediaByColor = new Map<string, string>();
  for (const variant of product.variants.nodes) {
    const sku = variant.sku?.trim() ?? "";
    const expected = expectedBySku.get(sku);
    if (!expected) continue;
    const color = selectedOptionValue(variant, "Color");
    const size = selectedOptionValue(variant, "Size");
    if (!sameValue(color, expected.colorName)) {
      throw new Error(`Shopify variant ${sku} Color mismatch: expected ${expected.colorName}, got ${color ?? "null"}`);
    }
    if (!sameValue(size, expected.size)) {
      throw new Error(`Shopify variant ${sku} Size mismatch: expected ${expected.size}, got ${size ?? "null"}`);
    }
    const mediaId = variant.media?.nodes?.[0]?.id ?? null;
    if (!mediaId) throw new Error(`Shopify variant ${sku} has no media`);
    const priorMedia = mediaByColor.get(normalize(expected.colorName));
    if (priorMedia && priorMedia !== mediaId) {
      throw new Error(`Shopify color ${expected.colorName} maps to multiple media IDs`);
    }
    mediaByColor.set(normalize(expected.colorName), mediaId);
  }

  if (product.variants.nodes.length !== expectedBySku.size) {
    throw new Error(`Shopify variant count mismatch: expected ${expectedBySku.size}, got ${product.variants.nodes.length}`);
  }
}

function selectedOptionValue(variant: ShopifyProductVariantNode, name: string): string | null {
  return variant.selectedOptions.find((option) => normalize(option.name) === normalize(name))?.value ?? null;
}

function optionValueNames(option: ShopifyProductOption): string[] {
  if (option.optionValues?.length) {
    return option.optionValues.map((value) => value.name).filter(Boolean);
  }
  return option.values ?? [];
}

function orderValuesByPrimary(values: string[], primary: string | null): string[] {
  return orderOptionValuesByPrimary(values, primary);
}

function orderSizeValues(values: string[]): string[] {
  const unique = uniqueInOrder(values);
  const rankBySize = new Map(APPAREL_SIZE_ORDER.map((size, index) => [normalize(size), index]));
  return [...unique].sort((a, b) => {
    const rankA = rankBySize.get(normalize(a)) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rankBySize.get(normalize(b)) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalize(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function sameOrderedValues(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => sameValue(value, b[index]));
}

function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalize(a ?? "") === normalize(b ?? "");
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function extractMockupAiColor(alt: string | null | undefined): string | null {
  const match = alt?.match(/^MockupAI color:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function assertNoUserErrors(
  label: string,
  errors: Array<{ field?: string | string[] | null; message: string; code?: string | null }>,
): void {
  if (!errors.length) return;
  const messages = errors.map((error) => {
    const field = Array.isArray(error.field) ? error.field.join(".") : error.field;
    const code = error.code ? ` [${error.code}]` : "";
    return field ? `${field}: ${error.message}${code}` : `${error.message}${code}`;
  });
  throw new Error(`${label} failed: ${messages.join("; ")}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
