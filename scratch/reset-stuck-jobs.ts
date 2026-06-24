import { prisma } from "../src/lib/db";

async function main() {
  console.log("Finding stuck mockup images corrupted by invalid job errors...");

  // Find all mockup images in "processing" state with the findUnique error
  const stuckImages = await prisma.mockupImage.findMany({
    where: {
      compositeStatus: "processing",
      compositeError: {
        contains: "mockupImage.findUnique"
      }
    },
    include: {
      mockupJob: true
    }
  });

  console.log(`Found ${stuckImages.length} corrupted images.`);

  if (stuckImages.length === 0) {
    console.log("No stuck/corrupted images found.");
    return;
  }

  const jobIdsToReset = [...new Set(stuckImages.map(img => img.mockupJobId))];
  console.log(`Resetting status for images and jobs...`);

  // Reset the images to pending
  const resetImagesResult = await prisma.mockupImage.updateMany({
    where: {
      id: { in: stuckImages.map(img => img.id) }
    },
    data: {
      compositeStatus: "pending",
      compositeError: null,
      compositeUrl: null
    }
  });
  console.log(`Reset ${resetImagesResult.count} images.`);

  // Reset the jobs to running
  const resetJobsResult = await prisma.mockupJob.updateMany({
    where: {
      id: { in: jobIdsToReset }
    },
    data: {
      status: "running",
      errorMessage: null
    }
  });
  console.log(`Reset ${resetJobsResult.count} jobs.`);

  console.log("Cleanup finished successfully!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
