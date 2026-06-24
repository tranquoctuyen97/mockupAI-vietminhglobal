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
  designPath?: string; // original design file path (optional if imageGroups provided)
  imageGroups?: Array<{ imageId: string; variantIds: number[] }>;
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

  // Step 1: Upload design image to Printify (base64) if imageGroups not provided
  let designImageId: string | undefined;
  if (!input.imageGroups?.length && input.designPath) {
    designImageId = await uploadImageBase64(
      headers,
      input.designPath,
      `design_${basename(input.designPath)}`,
    );
  }

  // Step 2: Create product
  // When explicit variants provided, print_areas must reference ALL their IDs
  const effectiveVariantIds = input.variants
    ? input.variants.map((v) => v.id)
    : input.variantIds;

  const printAreas = input.imageGroups?.length
    ? input.imageGroups.map((group) => ({
        variant_ids: group.variantIds,
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: group.imageId,
                ...mmToPrintifyCoords(
                  input.placementMm,
                  input.printAreaMm ?? { widthMm: 355.6, heightMm: 406.4 },
                ),
              },
            ],
          },
        ],
      }))
    : [
        {
          variant_ids: effectiveVariantIds,
          placeholders: [
            {
              position: "front",
              images: [
                {
                  id: designImageId!,
                  ...mmToPrintifyCoords(
                    input.placementMm,
                    input.printAreaMm ?? { widthMm: 355.6, heightMm: 406.4 },
                  ),
                },
              ],
            },
          ],
        },
      ];

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
    print_areas: printAreas,
    // Tell Printify which mockups to generate/publish
    ...(input.selectedMockupIds && input.selectedMockupIds.length > 0
      ? {
          visible_mockups: input.selectedMockupIds.filter(
            (id) => id && !id.startsWith("custom:") && !id.startsWith("synthetic:"),
          ),
        }
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
  const productId = productData.id;

  // visible_mockups behaves like a write-only mockup selection field in our runtime tests, but it is not documented in public Printify API docs.
  try {
    console.log(`[Printify] Product created: ${productId}. Polling for generated mockups...`);
    let mockupIds: string[] = [];
    const maxPollAttempts = 15;
    let latestProductDetails: any = null;

    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      // Wait 2s between attempts
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      try {
        const getRes = await fetch(
          `${PRINTIFY_BASE_URL}/shops/${input.shopId}/products/${productId}.json`,
          { headers }
        );
        if (getRes.ok) {
          const productDetails = await getRes.json();
          latestProductDetails = productDetails;
          const images = productDetails.images ?? [];
          
          // Get mockup_id from images
          const ids = images
            // Filter is_selected_for_publishing !== false
            .filter((img: any) => img.is_selected_for_publishing !== false)
            .map((img: any) => ({
              id: img.mockup_id || img.id,
              order: typeof img.order === "number" ? img.order : Infinity,
            }))
            .filter((item: any) => Boolean(item.id));

          if (ids.length > 0) {
            // Sort by order if available
            ids.sort((a: any, b: any) => a.order - b.order);
            mockupIds = ids.map((item: any) => item.id);
            console.log(`[Printify] Mockup IDs collected after ${attempt} attempts: ${mockupIds.length} images found.`);
            break;
          }
        }
      } catch (err) {
        console.warn(`[Printify] Error polling mockups on attempt ${attempt}:`, err);
      }
    }

    if (mockupIds.length === 0) {
      console.warn(`[Printify] Warning: No mockup IDs found for product ${productId}. Skipping PUT visible_mockups update.`);
    } else if (latestProductDetails) {
      console.log(`[Printify] Performing PUT update for visible_mockups on product ${productId}...`);
      
      // Build full valid payload using latest product details from GET as base
      const putVariants = (latestProductDetails.variants ?? []).map((v: any) => ({
        id: v.id,
        price: v.price,
        is_enabled: v.is_enabled,
        is_default: v.is_default,
        sku: v.sku,
      }));

      // Build print_areas, filtering out placeholders that don't have images (empty images array)
      const putPrintAreas = (latestProductDetails.print_areas ?? []).map((pa: any) => ({
        variant_ids: pa.variant_ids,
        placeholders: (pa.placeholders ?? [])
          .filter((ph: any) => ph.images && ph.images.length > 0)
          .map((ph: any) => ({
            position: ph.position,
            images: ph.images.map((img: any) => ({
              id: img.id,
              x: img.x,
              y: img.y,
              scale: img.scale,
              angle: img.angle,
            })),
          })),
      }));

      const putPayload = {
        title: latestProductDetails.title,
        description: latestProductDetails.description,
        blueprint_id: latestProductDetails.blueprint_id,
        print_provider_id: latestProductDetails.print_provider_id,
        variants: putVariants,
        print_areas: putPrintAreas,
        visible_mockups: mockupIds,
      };

      const updateRes = await fetch(
        `${PRINTIFY_BASE_URL}/shops/${input.shopId}/products/${productId}.json`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(putPayload),
        }
      );

      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        console.warn(`[Printify] Warning: PUT update for visible_mockups failed (${updateRes.status}): ${errorText}`);
      } else {
        console.log(`[Printify] PUT update succeeded for product ${productId}. Mockups selected count: ${mockupIds.length}`);
      }
    }
  } catch (error) {
    console.warn(`[Printify] Empirical visible_mockups workaround failed for product ${productId}:`, error);
  }

  return {
    printifyProductId: productId,
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
