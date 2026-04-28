import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runPrintifyStage } from '../src/lib/publish/worker';
import { getStorage } from '../src/lib/storage/local-disk';

async function testPrintify() {
  // Find a failed listing
  const listing = await prisma.listing.findFirst({
    where: { status: { in: ["FAILED", "PARTIAL_FAILURE"] } },
    orderBy: { createdAt: 'desc' },
    include: { variants: true, publishJobs: true, store: true }
  });

  if (!listing) {
    console.log('No failed listing found to test.');
    return;
  }

  if (!listing.wizardDraftId) {
    console.log(`Listing ${listing.id} has no wizardDraftId.`);
    return;
  }

  if (!listing.storeId) {
    console.log(`Listing ${listing.id} has no storeId.`);
    return;
  }

  console.log(`Testing Printify publish for Listing: ${listing.id} (Draft: ${listing.wizardDraftId})`);

  const draft = await prisma.wizardDraft.findUnique({
    where: { id: listing.wizardDraftId },
    include: { mockupJobs: true, design: true, store: { include: { template: true } } },
  });

  if (!draft) {
    console.log('Draft not found.');
    return;
  }

  // Get external shop ID
  let printifyApiKey: string | null = null;
  let externalShopId: number | null = null;
  try {
    const { getClientForStore } = await import("../src/lib/printify/account");
    const result = await getClientForStore(listing.storeId);
    printifyApiKey = (result.client as any).apiKey;
    externalShopId = result.externalShopId;
  } catch (err) {
    console.error('Failed to get Printify credentials:', err);
    return;
  }

  if (!printifyApiKey || !externalShopId) {
    console.log('Printify API Key or externalShopId missing.');
    return;
  }

  console.log(`Using externalShopId: ${externalShopId}`);

  // Create a fake event channel ID
  const channelId = `test-channel-${Date.now()}`;
  const storage = getStorage();

  console.log('Starting runPrintifyStage...');
  try {
    await runPrintifyStage(
      listing.id,
      listing,
      draft,
      listing.store,
      printifyApiKey,
      externalShopId,
      storage,
      false, // isDryRun
      channelId,
      draft.id
    );
    console.log('runPrintifyStage completed. Check the DB or Printify for the result.');
  } catch (error) {
    console.error('Error during runPrintifyStage:', error);
  }

  await prisma.$disconnect();
}

testPrintify();
