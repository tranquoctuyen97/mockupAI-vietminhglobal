/**
 * Printify Publish — Create product via REST API
 *
 * Flow:
 * 1. Upload mockup images via base64
 * 2. Create product with blueprint, provider, variants, print_areas
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const PRINTIFY_BASE_URL = "https://api.printify.com/v1";

export interface PrintifyPublishInput {
  apiKey: string;
  shopId: string;
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[]; // Printify variant IDs
  mockupPaths: string[]; // absolute file paths
  designPath: string; // original design file path
}

export interface PrintifyPublishResult {
  printifyProductId: string;
}

export async function publishToPrintify(
  input: PrintifyPublishInput,
): Promise<PrintifyPublishResult> {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };

  // Step 1: Upload design image to Printify (base64)
  const designImageId = await uploadImageBase64(
    headers,
    input.designPath,
    `design_${basename(input.designPath)}`,
  );

  // Step 2: Create product
  const productPayload = {
    title: input.title,
    description: input.description,
    blueprint_id: input.blueprintId,
    print_provider_id: input.printProviderId,
    variants: input.variantIds.map((id) => ({
      id,
      price: 0, // Price managed on Shopify side
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: input.variantIds,
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: designImageId,
                x: 0.5,
                y: 0.5,
                scale: 1,
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  };

  const createRes = await fetch(
    `${PRINTIFY_BASE_URL}/shops/${input.shopId}/products.json`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(productPayload),
    },
  );

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Printify create product failed (${createRes.status}): ${errorText}`);
  }

  const productData = (await createRes.json()) as { id: string };

  return {
    printifyProductId: productData.id,
  };
}

/**
 * Upload image to Printify via base64
 */
async function uploadImageBase64(
  headers: Record<string, string>,
  filePath: string,
  fileName: string,
): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const base64 = fileBuffer.toString("base64");

  const res = await fetch(`${PRINTIFY_BASE_URL}/uploads/images.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      file_name: fileName,
      contents: base64,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Printify image upload failed (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}
