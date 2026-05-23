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

    const images = await prisma.mockupImage.findMany({
      where: {
        mockupJob: {
          draftId: draft.id
        }
      },
      include: {
        mockupJob: true
      }
    });

    console.log("\nMockup Images for Draft:");
    for (const img of images) {
      console.log(`- ID: ${img.id}`);
      console.log(`  Color: ${img.colorName}`);
      console.log(`  SourceUrl: ${img.sourceUrl}`);
      console.log(`  CompositeUrl: ${img.compositeUrl}`);
      console.log(`  CompositeStatus: ${img.compositeStatus}`);
      console.log(`  CreatedAt: ${img.createdAt}`);
      console.log(`  UpdatedAt: ${img.updatedAt}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
