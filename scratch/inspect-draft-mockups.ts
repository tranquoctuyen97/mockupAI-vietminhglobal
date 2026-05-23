import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmpgoxaev000ja5t0a8yp5cux";
  console.log(`=== Inspecting Draft ${draftId} ===`);
  
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
    console.error("Draft not found!");
    return;
  }

  console.log("Draft info:");
  console.log(`- templateId: ${draft.templateId}`);
  console.log(`- defaultMockupSource (from template): ${draft.template?.defaultMockupSource}`);
  console.log(`- isCustomTemplateDefault: ${draft.template?.isCustomTemplateDefault}`);
  console.log(`- enabledColorIds:`, draft.enabledColorIds);

  console.log("\nMockup Jobs:");
  for (const job of draft.mockupJobs) {
    console.log(`- Job ${job.id}: status=${job.status}, totalImages=${job.totalImages}, completed=${job.completedImages}`);
    console.log(`  Images in job (${job.images.length}):`);
    for (const img of job.images) {
      console.log(`    * Image ID ${img.id}:`);
      console.log(`      colorName: ${img.colorName}`);
      console.log(`      included: ${img.included}`);
      console.log(`      viewPosition: ${img.viewPosition}`);
      console.log(`      printifyMockupId: ${img.printifyMockupId}`);
      console.log(`      sourceUrl: ${img.sourceUrl}`);
      console.log(`      compositeUrl: ${img.compositeUrl}`);
      console.log(`      compositeStatus: ${img.compositeStatus}`);
    }
  }

  // Also query CustomMockupSource
  const customSources = await prisma.customMockupSource.findMany({
    where: {
      OR: [
        { draftId: draftId },
        { templateId: draft.templateId ?? undefined }
      ],
      deletedAt: null
    }
  });
  console.log(`\nCustom Mockup Sources (${customSources.length}):`);
  for (const src of customSources) {
    console.log(`- Source ID ${src.id}: colorId=${src.colorId}, scope=${src.scope}, label=${src.label}, view=${src.view}, renderMode=${src.renderMode}, outputPath=${src.outputPath}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
