import { prisma } from "../src/lib/db";
import { getClientForStore, decryptAccountKey } from "../src/lib/printify/account";
import { publishToPrintify } from "../src/lib/publish/printify";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const listingId = "cmpho76jl001oa5t0ltmb7fdp"; // Active listing ID
  console.log("Loading listing:", listingId);
  const listing = await prisma.listing.findUnique({
    where: { id: listingId }
  });

  if (!listing) {
    console.error("Listing not found.");
    return;
  }

  // Get credentials
  const { client, externalShopId } = await getClientForStore(listing.storeId);
  
  // Decrypt apiKey
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: listing.storeId },
    include: {
      printifyShop: {
        include: {
          account: { select: { apiKeyEncrypted: true } },
        },
      },
    },
  });
  const apiKey = decryptAccountKey(store.printifyShop!.account.apiKeyEncrypted);

  // Let's create a temporary 1x1 png to pass as designPath
  const tempDir = path.join(__dirname, "../scratch");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
  const designPath = path.join(tempDir, "temp_test_design.png");
  const TRANSPARENT_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
  fs.writeFileSync(designPath, Buffer.from(TRANSPARENT_PNG_BASE64, "base64"));
  console.log("Created temp design file at:", designPath);

  // Fetch some catalog variants for the listing's printifyProductId blueprint to make it realistic
  // Let's first fetch the blueprint and print provider from listing's existing product
  console.log("Fetching existing product to get blueprint info...");
  const oldProduct = await client.getProduct(externalShopId, listing.printifyProductId!);
  const blueprintId = oldProduct.blueprint_id;
  const printProviderId = oldProduct.print_provider_id;
  console.log(`Blueprint ID: ${blueprintId}, Provider ID: ${printProviderId}`);

  const catalogResponse = await client.getBlueprintVariants(blueprintId, printProviderId);
  const catalogVariants = catalogResponse.variants.slice(0, 2); // just use first 2 variants

  const publishInput = {
    apiKey,
    shopId: externalShopId,
    title: `[TEST WORKAROUND] Mockup Sync ${Date.now()}`,
    description: "Temporary product to test visible_mockups sync.",
    blueprintId,
    printProviderId,
    variantIds: catalogVariants.map((v: any) => v.id),
    variants: catalogVariants.map((v: any) => ({
      id: v.id,
      price: 1500,
      is_enabled: true,
    })),
    mockupPaths: [],
    designPath,
    placementMm: {
      xMm: 100,
      yMm: 100,
      widthMm: 150,
      heightMm: 150,
      rotationDeg: 0,
    },
    printAreaMm: {
      widthMm: 355.6,
      heightMm: 406.4,
    }
  };

  console.log("\nCalling publishToPrintify (which runs POST and then our PUT workaround)...");
  const result = await publishToPrintify(publishInput);
  const createdProductId = result.printifyProductId;
  console.log("\nProduct published successfully! ID:", createdProductId);

  try {
    // --- VERIFICATION STEP via API ---
    console.log("\n========================================");
    console.log("VERIFYING RESULTS VIA API QUERY...");
    console.log("========================================");
    
    // Fetch product details from Printify, polling to wait for mockups to regenerate
    let productAfterPut: any = null;
    let images: any[] = [];
    console.log("Polling product details to wait for mockups to regenerate post-PUT...");
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      productAfterPut = await client.getProduct(externalShopId, createdProductId);
      images = productAfterPut.images ?? [];
      if (images.length > 0) {
        console.log(`Mockups regenerated! Found ${images.length} images.`);
        break;
      }
      console.log(`Still waiting for mockups (attempt ${i + 1})...`);
    }
    
    console.log(`Total mockup images returned: ${images.length}`);
    const selectedImages = images.filter((img: any) => img.is_selected_for_publishing === true);
    console.log(`Mockup images with is_selected_for_publishing === true: ${selectedImages.length}`);
    
    images.forEach((img: any, idx: number) => {
      console.log(`Image #${idx + 1}: mockup_id=${img.mockup_id}, is_selected_for_publishing=${img.is_selected_for_publishing}`);
    });

    if (selectedImages.length > 0) {
      console.log("\n[SUCCESS] Verification passed: is_selected_for_publishing has been set to true on generated mockups!");
    } else {
      console.error("\n[FAILURE] Verification failed: No mockup images have is_selected_for_publishing set to true.");
    }

  } catch (err) {
    console.error("Error during verification:", err);
  } finally {
    // Cleanup: delete the created product
    console.log("\nCleaning up: deleting temp product from Printify...");
    await client.deleteProduct(externalShopId, createdProductId);
    console.log("Deleted product.");
    // delete temp design file
    if (fs.existsSync(designPath)) {
      fs.unlinkSync(designPath);
    }
  }

  await prisma.$disconnect();
}

main();
