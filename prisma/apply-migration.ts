import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Applying migration 0024_rbac_inkhub...");

  // Step 1: Add SUPER_ADMIN to enum (must commit before use)
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'ADMIN'`);
    console.log("✓ Added SUPER_ADMIN to UserRole enum");
  } catch (e: any) {
    console.log("  enum:", e.message);
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS "tenant_role_permissions" (
      "id" TEXT NOT NULL,
      "tenant_id" TEXT NOT NULL,
      "role" "UserRole" NOT NULL,
      "feature" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "tenant_role_permissions_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "tenant_role_permissions_tenant_id_role_feature_key" ON "tenant_role_permissions"("tenant_id", "role", "feature")`,
    `CREATE INDEX IF NOT EXISTS "tenant_role_permissions_tenant_id_role_idx" ON "tenant_role_permissions"("tenant_id", "role")`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_role_permissions_tenant_id_fkey') THEN ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS "inkhub_credentials" (
      "id" TEXT NOT NULL,
      "tenant_id" TEXT NOT NULL,
      "username" TEXT NOT NULL,
      "password_encrypted" BYTEA NOT NULL,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "inkhub_credentials_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "inkhub_credentials_tenant_id_key" ON "inkhub_credentials"("tenant_id")`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inkhub_credentials_tenant_id_fkey') THEN ALTER TABLE "inkhub_credentials" ADD CONSTRAINT "inkhub_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$`,
  ];

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log("✓", sql.trim().substring(0, 70) + "...");
    } catch (e: any) {
      console.error("✗", e.message);
    }
  }

  console.log("\nDone.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
