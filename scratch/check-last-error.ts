import { prisma } from "../src/lib/db";

async function main() {
  const draftId = "cmqqrq5j10002lxt04nl1i9tq";
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: {
      draftDesigns: {
        select: {
          id: true,
          designId: true,
          lastError: true,
          design: { select: { name: true } }
        }
      }
    }
  });

  if (!draft) {
    console.error("Draft not found");
    return;
  }

  console.log("Draft Designs errors:");
  for (const dd of draft.draftDesigns) {
    console.log(`- Design: ${dd.design.name}`);
    console.log(`  lastError: ${dd.lastError}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
