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

    const sources = await prisma.customMockupSource.findMany({
      where: {
        draftId: draft.id,
        deletedAt: null
      },
      include: {
        color: true
      }
    });

    console.log("\nCustom Mockup Sources for Draft:");
    for (const src of sources) {
      console.log(`- ID: ${src.id}`);
      console.log(`  Color: ${src.color.name} (${src.color.id})`);
      console.log(`  Scope: ${src.scope}`);
      console.log(`  StoragePath: ${src.storagePath}`);
      console.log(`  OutputPath: ${src.outputPath}`);
      console.log(`  RenderMode: ${src.renderMode}`);
      console.log(`  CompositeRegionPx:`, src.compositeRegionPx);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
