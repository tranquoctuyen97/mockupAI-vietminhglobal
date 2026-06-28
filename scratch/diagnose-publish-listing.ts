import { runPublishWorker } from "../src/lib/publish/worker";
import { prisma } from "../src/lib/db";

async function main() {
  const listingId = "cmqqt6ums000qlxt0ospvjdsi";
  const listing = await prisma.listing.findUnique({
    where: { id: listingId }
  });

  if (!listing) {
    console.error("Listing not found!");
    return;
  }

  const draftId = listing.wizardDraftId!;
  const tenantId = listing.tenantId;

  console.log(`Diagnosing publish for Listing: ${listingId}, Draft: ${draftId}, Tenant: ${tenantId}`);

  // Let's reset the status of the listing and jobs to running/pending first
  await prisma.listing.update({
    where: { id: listingId },
    data: { status: "PUBLISHING" }
  });

  for (const job of await prisma.publishJob.findMany({ where: { listingId } })) {
    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: "PENDING", attempts: 0, lastError: null }
    });
  }

  try {
    await runPublishWorker({
      listingId,
      draftId,
      tenantId
    });
    console.log("diagnose: runPublishWorker completed.");
  } catch (err) {
    console.error("diagnose: runPublishWorker threw an error:", err);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
