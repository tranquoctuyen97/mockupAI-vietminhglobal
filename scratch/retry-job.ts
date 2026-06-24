import { getMockupCompositeQueue } from "../src/lib/mockup/queue";
import { prisma } from "../src/lib/db";

async function main() {
  const mockupImageId = "cmqqsfmqa000nlxt0ijnf3ekw";
  console.log(`Manually enqueueing mockup image: ${mockupImageId}`);

  const img = await prisma.mockupImage.findUnique({
    where: { id: mockupImageId },
    include: {
      mockupJob: {
        include: {
          draftDesign: {
            include: { design: true }
          }
        }
      }
    }
  });

  if (!img) {
    console.error("Mockup image not found in DB");
    return;
  }

  const designStoragePath = img.mockupJob.draftDesign?.design?.storagePath;
  if (!designStoragePath) {
    console.error("Design storage path not found!");
    return;
  }

  // Reset status to pending
  await prisma.mockupImage.update({
    where: { id: mockupImageId },
    data: { compositeStatus: "pending", compositeError: null }
  });

  const queue = getMockupCompositeQueue();
  const job = await queue.add("composite-custom-mockup", {
    mockupImageId: img.id,
    sourceUrl: img.sourceUrl,
    designStoragePath,
    placementData: {},
  });

  console.log(`Job added successfully! Job ID: ${job.id}`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
