import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqk7ke7l001hazt0kweq47uz";
  console.log(`Checking publish status for draft: ${draftId}`);

  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: {
      listings: {
        include: {
          publishJobs: true,
          variants: true
        }
      }
    }
  });

  if (!draft) {
    console.error("Draft not found!");
    return;
  }

  console.log("Draft status:", draft.status);
  console.log(`Found ${draft.listings.length} listings:`);

  for (const listing of draft.listings) {
    console.log(`\nListing ID: ${listing.id}`);
    console.log(`  Title: ${listing.title}`);
    console.log(`  Status: ${listing.status}`);
    console.log(`  Error: ${listing.errorMessage}`);
    console.log(`  Shopify Product ID: ${listing.externalProductId}`);
    console.log(`  Printify Product ID: ${listing.externalPrintifyProductId}`);
    console.log(`  Publish Jobs count: ${listing.publishJobs.length}`);
    for (const job of listing.publishJobs) {
      console.log(`    - Job ID: ${job.id}`);
      console.log(`      Stage: ${job.stage}`);
      console.log(`      Status: ${job.status}`);
      console.log(`      Error: ${job.errorMessage}`);
      console.log(`      Attempts: ${job.attempts}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
