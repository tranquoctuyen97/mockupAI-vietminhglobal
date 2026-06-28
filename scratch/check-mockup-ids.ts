import { prisma } from "../src/lib/db";

async function main() {
  const images = await prisma.mockupImage.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    select: { id: true, mockupJobId: true, colorName: true }
  });

  console.log("MockupImage IDs in DB:");
  console.log(JSON.stringify(images, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
