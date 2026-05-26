import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const stores = await prisma.store.findMany();
  console.log("=== STORES ===");
  console.log(JSON.stringify(stores.map(s => ({ id: s.id, name: s.name, printifyShopId: s.printifyShopId, status: s.status })), null, 2));

  const designs = await prisma.design.findMany();
  console.log("=== DESIGNS ===");
  console.log(JSON.stringify(designs.map(d => ({ id: d.id, name: d.name, previewUrl: d.previewUrl })), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
