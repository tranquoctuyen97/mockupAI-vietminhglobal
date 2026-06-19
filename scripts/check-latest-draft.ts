import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const draft = await prisma.wizardDraft.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    if (!draft) {
      console.log("No drafts found.");
      return;
    }

    console.log("Draft ID:", draft.id);

    const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
      where: { draftId: draft.id },
      include: {
        color: true,
        templateMockupItem: { include: { mockup: true } },
      },
    });

    console.log("\nMockup Library Picks for Draft:");
    for (const pick of picks) {
      console.log(`- Pick ID: ${pick.id}`);
      console.log(`  Color: ${pick.color.name} (${pick.color.id})`);
      console.log(`  TemplateMockupItemId: ${pick.templateMockupItemId}`);
      console.log(`  Mockup: ${pick.templateMockupItem.mockup.name}`);
      console.log(`  CompositeRegionPx:`, pick.compositeRegionPx);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
