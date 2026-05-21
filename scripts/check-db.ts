import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const columns: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name LIKE 'triple_whale%'
      ORDER BY table_name, column_name;
    `);
    console.log("Columns:\n", columns.map(c => `${c.table_name}.${c.column_name} (${c.data_type})`).join('\n'));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
