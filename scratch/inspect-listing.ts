import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmpgoxaev000ja5t0a8yp5cux";
  console.log(`=== Inspecting Listings for Draft ${draftId} ===`);
  
  const listings = await prisma.listing.findMany({
    where: { wizardDraftId: draftId },
    include: {
      variants: true,
      publishJobs: true
    }
  });

  console.log(`Found ${listings.length} listings:`);
  for (const list of listings) {
    console.log(`- Listing ID: ${list.id}`);
    console.log(`  title: ${list.title}`);
    console.log(`  status: ${list.status}`);
    console.log(`  shopifyProductId: ${list.shopifyProductId}`);
    console.log(`  printifyProductId: ${list.printifyProductId}`);
    console.log(`  publishJobs:`);
    for (const job of list.publishJobs) {
      console.log(`    * Job ID ${job.id}: stage=${job.stage}, status=${job.status}, error=${job.errorMessage}`);
    }
    console.log(`  variants:`);
    for (const v of list.variants) {
      console.log(`    * Variant ID ${v.id}: colorName=${v.colorName}, shopifyVariantId=${v.shopifyVariantId}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
