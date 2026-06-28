import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/lib/db";

async function main() {
  console.log("Testing prisma query...");
  const count = await prisma.wizardDraft.count();
  console.log("Draft count:", count);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
