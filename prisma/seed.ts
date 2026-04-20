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
  // Phase 6.7 — Placement Editor Polish
  {
    key: "placement_rotation_snap",
    enabled: true,
    description: "Snap rotation ±3° tại 0/45/90/135/180/270. Off để test chính xác không snap.",
  },
  {
    key: "placement_boundary_strict",
    enabled: true,
    description: "Chặn 'Tiếp theo' khi có violation error. Off → warn only (cho admin test).",
  },
  {
    key: "placement_mode_select",
    enabled: true,
    description: "Hiển thị dropdown placement mode (stretch/preserve/exact). Off → luôn dùng 'preserve'.",
  },
  {
    key: "placement_history_enabled",
    enabled: true,
    description: "Bật undo/redo stack 20 steps (Cmd+Z). Off để giảm RAM.",
  },
  // Phase 6.8 — Placement Editor Hardening
  {
    key: "placement_soft_clamp",
    enabled: true,
    description: "Numeric input ngoài safe range → border vàng + warn inline, không block nhập. Off → plain input.",
  },
  {
    key: "placement_validation_banner",
    enabled: true,
    description: "Hiển thị ValidationBanner đỏ/vàng trên canvas khi có violation. Off → không render banner (debug mode).",
  },
  // Phase 6.9 — Wizard Steps Polish
  {
    key: "ai_error_parser",
    enabled: true,
    description: "Parse lỗi Gemini/AI thành message tiếng Việt thân thiện. Off → show raw error (debug mode cho admin).",
  },
  {
    key: "wizard_manual_content",
    enabled: true,
    description: "Hiển thị CTA 'Viết tay' ở step-5. Off → chỉ AI content.",
  },
  {
    key: "wizard_pre_publish_checklist",
    enabled: true,
    description: "Checklist ready-to-publish ở step-6 với 4 điều kiện. Off → không validate, Publish luôn enable.",
  },
  {
    key: "mockup_stale_detection",
    enabled: true,
    description: "Banner cảnh báo mockup lỗi thời ở step-4 khi màu/design/placement đổi. Off → không show banner.",
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

  // 5. Seed system placement presets (Phase 6.6)
  const SYSTEM_PRESETS = [
    { key: "left_chest", name: "Left Chest", nameVi: "Ngực trái", position: "FRONT", defaultXMm: -90, defaultYMm: 110, defaultWidthMm: 75, defaultHeightMm: 75, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "right_chest", name: "Right Chest", nameVi: "Ngực phải", position: "FRONT", defaultXMm: 90, defaultYMm: 110, defaultWidthMm: 75, defaultHeightMm: 75, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "full_front", name: "Full Front", nameVi: "Mặt trước lớn", position: "FRONT", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 300, defaultHeightMm: 350, productTypes: ["tshirt", "hoodie", "sweatshirt", "tanktop"] },
    { key: "full_back", name: "Full Back", nameVi: "Mặt sau lớn", position: "BACK", defaultXMm: 0, defaultYMm: -50, defaultWidthMm: 300, defaultHeightMm: 400, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "sleeve_left", name: "Left Sleeve", nameVi: "Tay trái", position: "SLEEVE_LEFT", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 80, defaultHeightMm: 250, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "sleeve_right", name: "Right Sleeve", nameVi: "Tay phải", position: "SLEEVE_RIGHT", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 80, defaultHeightMm: 250, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "neck_label", name: "Neck Label", nameVi: "Nhãn cổ sau", position: "NECK_LABEL", defaultXMm: 0, defaultYMm: 0, defaultWidthMm: 100, defaultHeightMm: 30, productTypes: ["tshirt", "hoodie"] },
    { key: "hem", name: "Hem", nameVi: "Gấu áo", position: "HEM", defaultXMm: 0, defaultYMm: 250, defaultWidthMm: 200, defaultHeightMm: 50, productTypes: ["tshirt"] },
    // Phase 6.7 additions
    { key: "yoke", name: "Yoke", nameVi: "Vai sau", position: "BACK", defaultXMm: 0, defaultYMm: 15, defaultWidthMm: 180, defaultHeightMm: 60, productTypes: ["tshirt", "hoodie", "sweatshirt"] },
    { key: "lower_back", name: "Lower Back", nameVi: "Lưng dưới", position: "BACK", defaultXMm: 0, defaultYMm: 260, defaultWidthMm: 200, defaultHeightMm: 80, productTypes: ["tshirt", "hoodie"] },
  ];

  for (let i = 0; i < SYSTEM_PRESETS.length; i++) {
    const p = SYSTEM_PRESETS[i];
    await prisma.placementPreset.upsert({
      where: {
        id: `system_${p.key}`
      },
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
        tenantId: null, // System preset
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
      }
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
