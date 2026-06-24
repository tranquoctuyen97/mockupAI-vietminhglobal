import { loadMockupGenerationContext, prepareMockupGeneration, createCustomMockupJobForDraftDesign } from "../src/lib/mockup/generation";
import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqqrzm2y0009lxt07goieeqp";
  console.log("Triggering mockup generation for draft:", draftId);

  // Reset status to pending so it runs again
  await prisma.mockupImage.updateMany({
    where: {
      mockupJob: { draftId }
    },
    data: {
      compositeStatus: "pending",
      compositeUrl: null,
      compositeError: null
    }
  });

  await prisma.mockupJob.updateMany({
    where: { draftId },
    data: {
      status: "running",
      completedImages: 0,
      failedImages: 0,
      errorMessage: null
    }
  });

  const draftRecord = await prisma.wizardDraft.findUnique({ where: { id: draftId } });
  if (!draftRecord) {
    console.error("Draft not found!");
    return;
  }
  const tenantId = draftRecord.tenantId;

  try {
    const context = await loadMockupGenerationContext(draftId, tenantId);
    const prepared = await prepareMockupGeneration(context);
    const draftDesigns = context.draft.draftDesigns;

    console.log(`Found ${draftDesigns.length} draft designs.`);

    const jobs = [];
    for (const draftDesign of draftDesigns) {
      console.log(`\nProcessing draftDesign: ${draftDesign.id} (${draftDesign.design.name})`);
      try {
        const job = await createCustomMockupJobForDraftDesign(context, prepared, draftDesign);
        console.log("Job created successfully:", job);
        jobs.push(job);
      } catch (err: any) {
        console.error(`Error processing draftDesign ${draftDesign.id}:`, err);
      }
    }

    console.log("\nLoop finished. Jobs count:", jobs.length);
  } catch (err) {
    console.error("Error in prepare step:", err);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
