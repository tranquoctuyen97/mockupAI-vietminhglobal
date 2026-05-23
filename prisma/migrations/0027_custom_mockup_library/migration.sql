DO $$ BEGIN
  CREATE TYPE "CustomMockupView" AS ENUM (
    'front',
    'back',
    'sleeve_left',
    'sleeve_right',
    'detail',
    'lifestyle'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CustomMockupScene" AS ENUM (
    'flat_lay',
    'hanging',
    'lifestyle',
    'model',
    'detail'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CustomRenderMode" AS ENUM (
    'FINAL',
    'COMPOSITE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "custom_mockup_sources" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "color_id" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "output_path" TEXT,
  "label" TEXT,
  "view" "CustomMockupView" NOT NULL,
  "scene_type" "CustomMockupScene" NOT NULL,
  "render_mode" "CustomRenderMode" NOT NULL,
  "composite_region_px" JSONB,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "uploaded_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "custom_mockup_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "custom_mockup_sources_template_id_color_id_idx"
  ON "custom_mockup_sources"("template_id", "color_id");

CREATE INDEX IF NOT EXISTS "custom_mockup_sources_template_id_color_id_is_active_idx"
  ON "custom_mockup_sources"("template_id", "color_id", "is_active");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_mockup_sources_template_id_fkey') THEN
    ALTER TABLE "custom_mockup_sources"
      ADD CONSTRAINT "custom_mockup_sources_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "store_mockup_templates"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_mockup_sources_color_id_fkey') THEN
    ALTER TABLE "custom_mockup_sources"
      ADD CONSTRAINT "custom_mockup_sources_color_id_fkey"
      FOREIGN KEY ("color_id") REFERENCES "store_colors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_mockup_sources_uploaded_by_id_fkey') THEN
    ALTER TABLE "custom_mockup_sources"
      ADD CONSTRAINT "custom_mockup_sources_uploaded_by_id_fkey"
      FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_mockup_sources_updated_by_id_fkey') THEN
    ALTER TABLE "custom_mockup_sources"
      ADD CONSTRAINT "custom_mockup_sources_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "tenant_role_permissions" ("id", "tenant_id", "role", "feature")
SELECT 'mockup_library_admin_' || "id", "id", 'ADMIN'::"UserRole", 'mockup_library'
FROM "tenants"
ON CONFLICT ("tenant_id", "role", "feature") DO NOTHING;

INSERT INTO "tenant_role_permissions" ("id", "tenant_id", "role", "feature")
SELECT 'mockup_library_operator_' || "id", "id", 'OPERATOR'::"UserRole", 'mockup_library'
FROM "tenants"
ON CONFLICT ("tenant_id", "role", "feature") DO NOTHING;

DELETE FROM "tenant_role_permissions"
WHERE "role" = 'OPERATOR'::"UserRole"
  AND "feature" = 'stores';
