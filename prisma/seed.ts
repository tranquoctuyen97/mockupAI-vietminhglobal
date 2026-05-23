import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const ADMIN_DEFAULTS = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
  "mockup_library", "users", "pricing", "integrations", "ai_settings",
];

const OPERATOR_DEFAULTS = [
  "designs", "wizard", "listings", "auto_fulfill", "mockup_library",
];

async function main() {
  // ── SUPER_ADMIN (first user of the app) ──
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

  if (!superAdminEmail || !superAdminPassword) {
    throw new Error(
      "Set SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD (or ADMIN_EMAIL/ADMIN_PASSWORD) in environment",
    );
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

  // 2. Create SUPER_ADMIN user
  const passwordHash = await hash(superAdminPassword, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
    },
    create: {
      tenantId: tenant.id,
      email: superAdminEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  console.log(`✅ Super Admin: ${superAdmin.email} (${superAdmin.role})`);

  // 3. Seed RBAC permissions for all tenants
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  console.log(`🔐 Seeding RBAC permissions for ${tenants.length} tenant(s)...`);

  for (const t of tenants) {
    for (const feature of ADMIN_DEFAULTS) {
      await prisma.tenantRolePermission.upsert({
        where: { tenantId_role_feature: { tenantId: t.id, role: "ADMIN", feature } },
        create: { tenantId: t.id, role: "ADMIN", feature },
        update: {},
      });
    }
    for (const feature of OPERATOR_DEFAULTS) {
      await prisma.tenantRolePermission.upsert({
        where: { tenantId_role_feature: { tenantId: t.id, role: "OPERATOR", feature } },
        create: { tenantId: t.id, role: "OPERATOR", feature },
        update: {},
      });
    }
    console.log(`  ✓ Tenant ${t.id}`);
  }

  // 4. Feature flags — skipped (runtime defaults/env controls)
  console.log("✅ Feature flags: skipped (runtime defaults/env controls)");

  // 5. Audit event
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorUserId: superAdmin.id,
      action: "system.seeded",
      resourceType: "system",
      metadata: {
        flags: [],
        superAdminEmail: superAdmin.email,
      },
    },
  });
  console.log("✅ Audit event: system.seeded");

  // 6. System placement presets
  const SYSTEM_PRESETS = [
    { key: "left_chest", name: "Left Chest", nameVi: "Ngực trái", position: "FRONT", defaultXMm: -90, defaultYMm: 110, defaultWidthMm: 75, defaultHeightMm: 75, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "right_chest", name: "Right Chest", nameVi: "Ngực phải", position: "FRONT", defaultXMm: 90, defaultYMm: 110, defaultWidthMm: 75, defaultHeightMm: 75, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "full_front", name: "Full Front", nameVi: "Mặt trước lớn", position: "FRONT", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 300, defaultHeightMm: 350, productTypes: ["tshirt", "hoodie", "sweatshirt", "tanktop"] },
    { key: "full_back", name: "Full Back", nameVi: "Mặt sau lớn", position: "BACK", defaultXMm: 0, defaultYMm: -50, defaultWidthMm: 300, defaultHeightMm: 400, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "sleeve_left", name: "Left Sleeve", nameVi: "Tay trái", position: "SLEEVE_LEFT", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 80, defaultHeightMm: 250, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "sleeve_right", name: "Right Sleeve", nameVi: "Tay phải", position: "SLEEVE_RIGHT", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 80, defaultHeightMm: 250, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "neck_label", name: "Neck Label", nameVi: "Nhãn cổ sau", position: "NECK_LABEL", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 100, defaultHeightMm: 30, productTypes: ["tshirt", "hoodie"] },
    { key: "hem", name: "Hem", nameVi: "Gấu áo", position: "HEM", defaultXMm: 0, defaultYMm: 250, defaultWidthMm: 200, defaultHeightMm: 50, productTypes: ["tshirt"] },
    { key: "yoke", name: "Yoke", nameVi: "Vai sau", position: "BACK", defaultXMm: 0, defaultYMm: 15, defaultWidthMm: 180, defaultHeightMm: 60, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "lower_back", name: "Lower Back", nameVi: "Lưng dưới", position: "BACK", defaultXMm: 0, defaultYMm: 260, defaultWidthMm: 200, defaultHeightMm: 80, productTypes: ["tshirt", "hoodie"] },
  ];

  for (let i = 0; i < SYSTEM_PRESETS.length; i++) {
    const p = SYSTEM_PRESETS[i];
    await prisma.placementPreset.upsert({
      where: { id: `system_${p.key}` },
      update: {
        name: p.name,
        nameVi: p.nameVi,
        position: p.position as any,
        defaultXMm: p.defaultXMm,
        defaultYMm: p.defaultYMm,
        defaultWidthMm: p.defaultWidthMm,
        defaultHeightMm: p.defaultHeightMm,
        productTypes: p.productTypes,
        sortOrder: i,
      },
      create: {
        id: `system_${p.key}`,
        tenantId: null,
        key: p.key,
        name: p.name,
        nameVi: p.nameVi,
        position: p.position as any,
        defaultXMm: p.defaultXMm,
        defaultYMm: p.defaultYMm,
        defaultWidthMm: p.defaultWidthMm,
        defaultHeightMm: p.defaultHeightMm,
        productTypes: p.productTypes,
        sortOrder: i,
      },
    });
  }
  console.log(`✅ System Placement Presets seeded (${SYSTEM_PRESETS.length})`);

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
