import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqqrq5j10002lxt04nl1i9tq";
  console.log(`Checking draft: ${draftId}`);
  
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: {
      draftDesigns: {
        include: {
          design: true,
          jobs: {
            orderBy: { createdAt: "desc" },
            include: {
              images: true
            }
          }
        }
      },
      mockupJobs: {
        orderBy: { createdAt: "desc" },
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

  console.log("\n--- DRAFT INFO ---");
  console.log(`Status: ${draft.status}`);
  console.log(`Mockups Stale: ${draft.mockupsStale}`);
  console.log(`Mockups Stale Reason: ${draft.mockupsStaleReason}`);
  console.log(`Enabled Colors: ${JSON.stringify(draft.enabledColorIds)}`);

  console.log("\n--- DRAFT DESIGNS & JOBS ---");
  for (const dd of draft.draftDesigns) {
    console.log(`DraftDesign ID: ${dd.id}, Design: ${dd.design.name} (${dd.designId})`);
    console.log(`Jobs count: ${dd.jobs.length}`);
    for (const job of dd.jobs) {
      const completedCount = job.images.filter(img => img.compositeStatus === "completed").length;
      const failedCount = job.images.filter(img => img.compositeStatus === "failed").length;
      const pendingCount = job.images.filter(img => img.compositeStatus === "pending").length;
      const processingCount = job.images.filter(img => img.compositeStatus === "processing").length;
      console.log(`  Job ID: ${job.id}`);
      console.log(`    Status: ${job.status}`);
      console.log(`    Total Images: ${job.totalImages} (Images list length: ${job.images.length})`);
      console.log(`    Completed: ${completedCount}, Failed: ${failedCount}, Pending: ${pendingCount}, Processing: ${processingCount}`);
      if (job.errorMessage) {
        console.log(`    Error Message: ${job.errorMessage}`);
      }
      if (job.images.length > 0) {
        console.log("    Sample Images:");
        job.images.slice(0, 5).forEach(img => {
          console.log(`      - Color: ${img.colorName}, Position: ${img.viewPosition}, Status: ${img.compositeStatus}, Error: ${img.compositeError}`);
        });
      }
    }
  }

  console.log("\n--- GENERAL DRAFT MOCKUP JOBS (not tied to DraftDesign directly) ---");
  for (const job of draft.mockupJobs) {
    if (!job.draftDesignId) {
      console.log(`  Job ID: ${job.id}`);
      console.log(`    Status: ${job.status}`);
      console.log(`    Total Images: ${job.totalImages}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
