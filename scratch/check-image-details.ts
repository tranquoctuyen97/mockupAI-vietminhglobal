import { prisma } from "../src/lib/db";

async function main() {
  const jobId = "cmqqsfmpt000mlxt0x1t8xzfm";
  console.log(`Checking mockup job: ${jobId}`);

  const job = await prisma.mockupJob.findUnique({
    where: { id: jobId },
    include: {
      images: true,
      draftDesign: true,
    }
  });

  if (!job) {
    console.error("Job not found!");
    return;
  }

  console.log("Job status:", job.status);
  console.log("Job error:", job.errorMessage);
  console.log("Job totalImages:", job.totalImages);
  console.log("Job completedImages:", job.completedImages);
  console.log("Job failedImages:", job.failedImages);
  console.log("Job placementSnapshot:", JSON.stringify(job.placementSnapshot));

  console.log("\nImages:");
  for (const img of job.images) {
    console.log(JSON.stringify({
      id: img.id,
      colorName: img.colorName,
      viewPosition: img.viewPosition,
      sourceUrl: img.sourceUrl,
      compositeUrl: img.compositeUrl,
      compositeStatus: img.compositeStatus,
      compositeError: img.compositeError,
      printifyMockupId: img.printifyMockupId,
    }, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
