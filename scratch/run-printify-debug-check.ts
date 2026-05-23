import { prisma } from "../src/lib/db";
import { getClientForStore } from "../src/lib/printify/account";

// Helper for recursive key search
function recursiveSearchKeys(obj: any, targetKeys: string[], path = ""): Array<{ path: string; value: any }> {
  const results: Array<{ path: string; value: any }> = [];
  if (!obj || typeof obj !== "object") return results;

  for (const key of Object.keys(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (targetKeys.includes(key)) {
      results.push({ path: currentPath, value: obj[key] });
    }
    if (typeof obj[key] === "object") {
      results.push(...recursiveSearchKeys(obj[key], targetKeys, currentPath));
    }
  }
  return results;
}

async function main() {
  try {
    const listingId = "cmpho76jl001oa5t0ltmb7fdp"; // Active listing ID
    console.log("Querying listing:", listingId);
    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!listing || !listing.printifyProductId) {
      console.log("Listing or Printify product ID not found.");
      return;
    }

    const { client, externalShopId } = await getClientForStore(listing.storeId);
    const productId = listing.printifyProductId;
    
    // --- PART 1: Query the existing product (which had PUT visible_mockups run) ---
    console.log(`\n========================================`);
    console.log(`PART 1: Fetching existing product details: ${productId}`);
    console.log(`========================================`);
    const product = await client.getProduct(externalShopId, productId);

    // 1. Log keys of images[0]
    const firstImage = product.images?.[0] ?? {};
    console.log("\n1. Keys of images[0]:", Object.keys(firstImage));

    // 2. Log sample
    console.log("\n2. Log sample of up to 5 images:");
    const sampleImages = (product.images ?? []).slice(0, 5).map((img: any) => ({
      src: img.src?.substring(0, 80) + "...",
      id: img.id,
      mockup_id: img.mockup_id,
      variant_ids: img.variant_ids,
      position: img.position,
      is_default: img.is_default,
      is_selected_for_publishing: img.is_selected_for_publishing
    }));
    console.log(JSON.stringify(sampleImages, null, 2));

    // 3. Recursive search keys
    console.log("\n3. Recursive search keys in product details:");
    const searchKeys = ["visible_mockups", "mockup_id", "is_selected_for_publishing", "selected_mockups"];
    const searchResults = recursiveSearchKeys(product, searchKeys);
    console.log(searchResults.length > 0 ? searchResults : "None found");


    // --- PART 2: Create a fresh dummy product to show BEFORE/AFTER PUT visible_mockups ---
    console.log(`\n========================================`);
    console.log(`PART 2: Creating a fresh dummy product to show Before/After PUT visible_mockups`);
    console.log(`========================================`);

    // Upload a 1x1 transparent PNG for design
    const TRANSPARENT_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
    console.log("Uploading dummy design image...");
    const uploadRes = await client.uploadImageBase64({
      fileName: "temp_debug_image.png",
      contentsBase64: TRANSPARENT_PNG_BASE64,
    });
    const dummyImageId = uploadRes.id;
    console.log("Dummy image uploaded, ID:", dummyImageId);

    // Get catalog variants for the same blueprint & provider as the actual product
    const blueprintId = product.blueprint_id;
    const printProviderId = product.print_provider_id;
    console.log(`Fetching catalog variants for blueprint ${blueprintId} / provider ${printProviderId}...`);
    const catalogResponse = await client.getBlueprintVariants(blueprintId, printProviderId);
    const catalogVariants = catalogResponse.variants.slice(0, 2); // just use first 2 variants

    const dummyPayload = {
      title: `[DEBUG_TEMP] Mockup Sync Test ${Date.now()}`,
      description: "Temporary product to test mockup sync. Auto-deleted.",
      blueprint_id: blueprintId,
      print_provider_id: printProviderId,
      variants: catalogVariants.map((v: any) => ({
        id: v.id,
        price: 1500,
        is_enabled: true,
      })),
      print_areas: [
        {
          variant_ids: catalogVariants.map((v: any) => v.id),
          placeholders: [
            {
              position: "front",
              images: [
                {
                  id: dummyImageId,
                  x: 0.5,
                  y: 0.5,
                  scale: 0.5,
                  angle: 0,
                },
              ],
            },
          ],
        },
      ],
    };

    console.log("Creating dummy product on Printify...");
    const dummyProduct = await client.createProduct(externalShopId, dummyPayload);
    const dummyProductId = dummyProduct.id;
    console.log("Dummy product created. ID:", dummyProductId);

    try {
      // Poll until mockups are generated
      console.log("Polling product until mockups are generated...");
      let dummyProductWithMockups: any = null;
      let mockupIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const checkProduct = await client.getProduct(externalShopId, dummyProductId);
        const ids = (checkProduct.images ?? []).map((img: any) => img.mockup_id).filter(Boolean);
        if (ids.length > 0) {
          dummyProductWithMockups = checkProduct;
          mockupIds = ids;
          console.log(`Mockups generated! Found ${ids.length} mockups.`);
          break;
        }
        console.log("Still polling (attempt " + (i + 1) + ")...");
      }

      if (!dummyProductWithMockups) {
        console.log("Failed to generate mockups in time.");
        return;
      }

      console.log("\n4a. DUMP BEFORE PUT visible_mockups:");
      console.log("Sample mockup images state:");
      console.log(JSON.stringify(dummyProductWithMockups.images.map((img: any) => ({
        mockup_id: img.mockup_id,
        is_selected_for_publishing: img.is_selected_for_publishing
      })), null, 2));

      // Perform PUT update with visible_mockups, matching the actual variants and print_areas of the created product
      const putVariants = (dummyProductWithMockups.variants ?? []).map((v: any) => ({
        id: v.id,
        price: v.price,
        is_enabled: v.is_enabled,
        is_default: v.is_default,
        sku: v.sku,
      }));

      const putPrintAreas = (dummyProductWithMockups.print_areas ?? []).map((pa: any) => ({
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
        title: dummyProductWithMockups.title,
        description: dummyProductWithMockups.description,
        blueprint_id: dummyProductWithMockups.blueprint_id,
        print_provider_id: dummyProductWithMockups.print_provider_id,
        variants: putVariants,
        print_areas: putPrintAreas,
        visible_mockups: mockupIds
      };
      console.log("\nSending PUT update to set visible_mockups:", mockupIds);
      const updatedDummy = await client.updateProduct(externalShopId, dummyProductId, putPayload);

      console.log("\n4b. DUMP AFTER PUT visible_mockups:");
      console.log("Sample mockup images state:");
      console.log(JSON.stringify(updatedDummy.images.map((img: any) => ({
        mockup_id: img.mockup_id,
        is_selected_for_publishing: img.is_selected_for_publishing
      })), null, 2));

    } finally {
      // Cleanup: delete the dummy product
      console.log("\nCleaning up dummy product from Printify...");
      await client.deleteProduct(externalShopId, dummyProductId);
      console.log("Dummy product deleted.");
    }

  } catch (error) {
    console.error("Error in debug script:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
