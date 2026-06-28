import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqqrq5j10002lxt04nl1i9tq";

  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: {
      template: true,
      mockupJobs: {
        include: {
          images: true
        }
      }
    }
  });

  if (!draft) {
    console.error("Draft not found");
    return;
  }

  console.log("Draft ID:", draft.id);
  console.log("Template ID:", draft.templateId);
  console.log("Template Name:", draft.template?.name);
  console.log("Template DefaultMockupSource:", draft.template?.defaultMockupSource);
  
  console.log("\nMockup Jobs:");
  for (const job of draft.mockupJobs) {
    console.log(`- Job ID: ${job.id}`);
    console.log(`  DraftDesign ID: ${job.draftDesignId}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Total Images: ${job.totalImages}`);
    console.log(`  Completed: ${job.completedImages}`);
    console.log(`  Failed: ${job.failedImages}`);
    console.log(`  CreatedAt: ${job.createdAt}`);
    console.log(`  UpdatedAt: ${job.updatedAt}`);
    
    // Check if there are any images in MockupImage table
    const images = job.images;
    console.log(`  Images count: ${images.length}`);
    images.forEach(img => {
      console.log(`    * Image ID: ${img.id}`);
      console.log(`      Color: ${img.colorName}`);
      console.log(`      View: ${img.viewPosition}`);
      console.log(`      SourceUrl: ${img.sourceUrl}`);
      console.log(`      CompositeUrl: ${img.compositeUrl}`);
      console.log(`      CompositeStatus: ${img.compositeStatus}`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
