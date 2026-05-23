import { prisma } from "../src/lib/db";
import { getClientForStore } from "../src/lib/printify/account";

async function main() {
  try {
    const listing = await prisma.listing.findFirst({
      where: {
        printifyProductId: {
          not: null,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!listing) {
      console.log("No listing found with a Printify product ID.");
      return;
    }

    const { client, externalShopId } = await getClientForStore(listing.storeId);
    
    console.log(`Fetching Printify product: ${listing.printifyProductId} for shop: ${externalShopId}`);
    const product = await client.getProduct(externalShopId, listing.printifyProductId!);
    
    const fs = require("fs");
    fs.writeFileSync("scratch/product_details.json", JSON.stringify(product, null, 2));
    console.log("Saved details to scratch/product_details.json");

  } catch (error) {
    console.error("Error in debug script:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
