import { prisma } from "../src/lib/db";
import { getClientForStore } from "../src/lib/printify/account";

async function main() {
  try {
    const listingId = "cmpho76jl001oa5t0ltmb7fdp"; // listing ID from inspect-listing
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
    console.log(`Fetching product ${productId} from Printify...`);
    const product = await client.getProduct(externalShopId, productId);

    const existingMockupIds = (product.images ?? [])
      .map((img: any) => img.mockup_id)
      .filter(Boolean);

    console.log("Existing Mockup IDs:", existingMockupIds);

    if (existingMockupIds.length === 0) {
      console.log("No mockup IDs found on the product yet. Are they still generating?");
      return;
    }

    // Build payload for PUT update
    // We construct a full payload including variants, print_areas, and visible_mockups
    const variants = (product.variants ?? []).map((v: any) => ({
      id: v.id,
      price: v.price,
      is_enabled: v.is_enabled,
      is_default: v.is_default,
      sku: v.sku,
    }));

    const print_areas = (product.print_areas ?? []).map((pa: any) => ({
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

    const payload = {
      title: product.title,
      description: product.description,
      blueprint_id: product.blueprint_id,
      print_provider_id: product.print_provider_id,
      variants,
      print_areas,
      visible_mockups: existingMockupIds,
    };

    console.log("Sending PUT update with visible_mockups:", existingMockupIds);
    const updatedProduct = await client.updateProduct(externalShopId, productId, payload);
    console.log("Product updated successfully!");
    console.log("Updated Product images:", JSON.stringify(updatedProduct.images, null, 2));

  } catch (error) {
    console.error("Error updating product:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
