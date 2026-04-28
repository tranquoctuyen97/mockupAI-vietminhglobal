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
  variants?: Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }>;
  mockupPaths: string[]; // absolute file paths
  selectedMockupIds?: string[]; // Printify mockup IDs selected by user
  designPath: string; // original design file path
  // Phase 6.10: placement from store preset
  placementMm?: {
    xMm: number;
    yMm: number;
    widthMm: number;
    heightMm: number;
    rotationDeg: number;
  };
  printAreaMm?: {
    widthMm: number;
    heightMm: number;
  };
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
  // When explicit variants provided, print_areas must reference ALL their IDs
  const effectiveVariantIds = input.variants
    ? input.variants.map(v => v.id)
    : input.variantIds;

  const productPayload = {
    title: input.title,
    description: input.description,
    blueprint_id: input.blueprintId,
    print_provider_id: input.printProviderId,
    variants: input.variants ?? input.variantIds.map((id) => ({
      id,
      price: 2000, // Fallback if variants list not provided
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: effectiveVariantIds,
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: designImageId,
                ...mmToPrintifyCoords(
                  input.placementMm,
                  input.printAreaMm ?? { widthMm: 355.6, heightMm: 406.4 },
                ),
              },
            ],
          },
        ],
      },
    ],
    // Tell Printify which mockups to generate/publish
    ...(input.selectedMockupIds && input.selectedMockupIds.length > 0 
      ? { visible_mockups: input.selectedMockupIds } 
      : {}),
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

/**
 * Convert mm placement → Printify relative coordinates
 * Printify uses: x, y = center of image (0..1 relative to print area)
 *                scale = image width / print area width
 *                angle = rotation in degrees
 */
function mmToPrintifyCoords(
  placement?: { xMm: number; yMm: number; widthMm: number; heightMm: number; rotationDeg: number },
  printArea: { widthMm: number; heightMm: number } = { widthMm: 355.6, heightMm: 406.4 },
): { x: number; y: number; scale: number; angle: number } {
  if (!placement) {
    return { x: 0.5, y: 0.5, scale: 1, angle: 0 };
  }

  // Printify x, y = center of design relative to print area (0..1)
  const centerXMm = placement.xMm + placement.widthMm / 2;
  const centerYMm = placement.yMm + placement.heightMm / 2;

  return {
    x: Math.round((centerXMm / printArea.widthMm) * 1000) / 1000,
    y: Math.round((centerYMm / printArea.heightMm) * 1000) / 1000,
    scale: Math.round((placement.widthMm / printArea.widthMm) * 1000) / 1000,
    angle: placement.rotationDeg,
  };
}
