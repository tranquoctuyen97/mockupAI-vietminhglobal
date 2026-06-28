import { prisma } from "../src/lib/db";

async function main() {
  const today = new Date("2026-06-23T00:00:00Z");
  console.log("Checking mockup jobs created since:", today.toISOString());

  const jobs = await prisma.mockupJob.findMany({
    where: {
      createdAt: {
        gte: today
      }
    },
    include: {
      images: {
        select: {
          id: true,
          colorName: true,
          viewPosition: true,
          compositeStatus: true,
          compositeError: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  console.log(`Found ${jobs.length} jobs created today:`);
  for (const job of jobs) {
    console.log(`\nJob ID: ${job.id}`);
    console.log(`  Draft ID: ${job.draftId}`);
    console.log(`  DraftDesign ID: ${job.draftDesignId}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Total Images: ${job.totalImages}`);
    console.log(`  Completed: ${job.completedImages}`);
    console.log(`  Failed: ${job.failedImages}`);
    console.log(`  CreatedAt: ${job.createdAt.toISOString()}`);
    console.log(`  UpdatedAt: ${job.updatedAt.toISOString()}`);
    console.log(`  Images count: ${job.images.length}`);
    job.images.forEach(img => {
      console.log(`    - ID: ${img.id}, Color: ${img.colorName}, Status: ${img.compositeStatus}`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
