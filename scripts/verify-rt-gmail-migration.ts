import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const migrationName = process.argv[2];

if (!migrationName) {
  console.error("[rt-gmail-migrate] missing migration name");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: number }>>(
    `SELECT 1 AS "exists"
     FROM "_prisma_migrations"
     WHERE migration_name = $1
       AND finished_at IS NOT NULL
       AND rolled_back_at IS NULL
     LIMIT 1`,
    migrationName,
  );

  if (rows.length !== 1) {
    console.error(`[rt-gmail-migrate] migration not applied: ${migrationName}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[rt-gmail-migrate] migration verification failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
