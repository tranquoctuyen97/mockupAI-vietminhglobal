import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqqrq5j10002lxt04nl1i9tq";
  const templateMockupItemId = "cmqn8xx5d000ampt0w0i2nyxb";
  const colorId = "cmpf8kv9u0002u9t0vjjr4uar";

  console.log("Checking picks for draftId:", draftId);
  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: { draftId },
    include: {
      templateMockupItem: {
        include: { mockup: true }
      }
    }
  });

  console.log(`Found ${picks.length} picks in total.`);
  for (const pick of picks) {
    console.log(`- Pick ID: ${pick.id}`);
    console.log(`  templateMockupItemId: ${pick.templateMockupItemId}`);
    console.log(`  colorId: ${pick.colorId}`);
    console.log(`  isPrimary: ${pick.isPrimary}`);
    console.log(`  compositeRegionPx: ${JSON.stringify(pick.compositeRegionPx)}`);
    console.log(`  mockupName: ${pick.templateMockupItem.mockup.name}`);
  }

  const targetPick = await prisma.wizardDraftMockupLibraryPick.findFirst({
    where: {
      draftId,
      templateMockupItemId,
      colorId,
    }
  });

  console.log("\nTarget pick:", targetPick);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
