import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_FLAGS = [
  {
    key: "auto_fulfill_enabled",
    enabled: true,
    description: "Kill-switch cho auto-fulfill Printify. Tắt → operator fulfill thủ công.",
  },
  {
    key: "ai_multi_provider",
    enabled: false,
    description: "Reserve cho v1.1 nếu muốn thêm Claude/OpenAI bên cạnh Gemini.",
  },
  {
    key: "mockup_fallback_force",
    enabled: false,
    description: "Force local composite (sharp) thay vì Printify Mockup API.",
  },
  {
    key: "publish_dry_run",
    enabled: false,
    description: "Publish simulate không gọi Shopify/Printify API thật.",
  },
  {
    key: "ai_prompt_version",
    enabled: true,
    description: "A/B test prompt mới. rollout_percent để điều chỉnh.",
  },
  {
    key: "retention_cleanup_enabled",
    enabled: true,
    description: "Kill-switch cho cron xóa file sau 7 ngày soft-delete.",
  },
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment");
  }

  console.log("🌱 Seeding MockupAI database...");

  // 1. Create default tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: "default-tenant" },
    update: {},
    create: {
      id: "default-tenant",
      name: "MockupAI Default",
    },
  });
  console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Create admin user
  const passwordHash = await hash(adminPassword, {
    memoryCost: 65536, // 64MB
    timeCost: 3,
    parallelism: 1,
  });

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  console.log(`✅ Admin user: ${admin.email} (${admin.role})`);

  // 3. Seed feature flags
  for (const flag of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {
        description: flag.description,
      },
      create: {
        key: flag.key,
        enabled: flag.enabled,
        description: flag.description,
        rolloutPercent: 100,
      },
    });
  }
  console.log(`✅ Feature flags: ${DEFAULT_FLAGS.length} flags seeded`);

  // 4. Seed audit event for initial setup
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorUserId: admin.id,
      action: "system.seeded",
      resourceType: "system",
      metadata: {
        flags: DEFAULT_FLAGS.map((f) => f.key),
        adminEmail: admin.email,
      },
    },
  });
  console.log("✅ Audit event: system.seeded");

  console.log("\n🎉 Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
