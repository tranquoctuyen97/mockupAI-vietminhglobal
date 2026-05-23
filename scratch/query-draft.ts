import { prisma } from "../src/lib/db";

async function main() {
  try {
    const draftId = "cmpgoxaev000ja5t0a8yp5cux";
    console.log("Querying draft:", draftId);
    const draft = await prisma.wizardDraft.findUnique({
      where: { id: draftId }
    });
    console.log("Draft:", JSON.stringify(draft, null, 2));

    console.log("\nQuerying design...");
    const design = await prisma.design.findUnique({
      where: { id: draft.designId }
    });
    console.log("Design:", JSON.stringify(design, null, 2));

    console.log("\nQuerying mockup sources for draft...");
    const sources = await prisma.customMockupSource.findMany({
      where: { draftId }
    });
    console.log("Mockup Sources count:", sources.length);
    for (const src of sources) {
      console.log(`Source ID: ${src.id}, scope: ${src.scope}, colorId: ${src.colorId}, renderMode: ${src.renderMode}, isPrimary: ${src.isPrimary}`);
      console.log(`compositeRegionPx:`, JSON.stringify(src.compositeRegionPx, null, 2));
      console.log(`storagePath: ${src.storagePath}`);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
