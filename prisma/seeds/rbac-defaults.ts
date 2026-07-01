import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ADMIN_DEFAULTS = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
  "mockup_library", "ai_hub", "users", "pricing", "integrations", "ai_settings",
];

const OPERATOR_DEFAULTS = [
  "designs", "wizard", "listings", "auto_fulfill", "mockup_library", "ai_hub",
];

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  console.log(`Seeding permissions for ${tenants.length} tenant(s)...`);

  for (const tenant of tenants) {
    for (const feature of ADMIN_DEFAULTS) {
      await prisma.tenantRolePermission.upsert({
        where: { tenantId_role_feature: { tenantId: tenant.id, role: "ADMIN", feature } },
        create: { tenantId: tenant.id, role: "ADMIN", feature },
        update: {},
      });
    }
    for (const feature of OPERATOR_DEFAULTS) {
      await prisma.tenantRolePermission.upsert({
        where: { tenantId_role_feature: { tenantId: tenant.id, role: "OPERATOR", feature } },
        create: { tenantId: tenant.id, role: "OPERATOR", feature },
        update: {},
      });
    }
    console.log(`  ✓ Tenant ${tenant.id}`);
  }
  console.log("Done.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
