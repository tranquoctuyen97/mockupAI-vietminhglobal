import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqk7ke7l001hazt0kweq47uz";
  console.log(`Checking mockup images for draft: ${draftId}`);

  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: {
      mockupJobs: {
        include: {
          images: true
        }
      }
    }
  });

  if (!draft) {
    console.error("Draft not found!");
    return;
  }

  console.log(`Found ${draft.mockupJobs.length} mockup jobs:`);
  for (const job of draft.mockupJobs) {
    console.log(`\nJob ID: ${job.id}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Draft Design ID: ${job.draftDesignId}`);
    console.log(`  Total images: ${job.totalImages}`);
    for (const image of job.images) {
      console.log(`    - Image ID: ${image.id}`);
      console.log(`      Color: ${image.colorName}`);
      console.log(`      Included: ${image.included}`);
      console.log(`      Composite Status: ${image.compositeStatus}`);
      console.log(`      Composite URL: ${image.compositeUrl}`);
      console.log(`      Source URL: ${image.sourceUrl}`);
      console.log(`      Printify Mockup ID: ${image.printifyMockupId}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
