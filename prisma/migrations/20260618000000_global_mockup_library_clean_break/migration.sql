-- Global Mockup Library Clean Break
-- Replaces store-scoped CustomMockupSource with tenant-level MockupLibraryItem
-- and template-scoped TemplateMockupItem join table.

-- 1. Create new enum types
DO $$ BEGIN
  CREATE TYPE "MockupLibraryRenderMode" AS ENUM ('COMPOSITE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MockupLibraryView" AS ENUM ('front', 'back', 'sleeve_left', 'sleeve_right', 'detail', 'lifestyle');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MockupLibraryScene" AS ENUM ('flat_lay', 'hanging', 'lifestyle', 'model', 'detail');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create mockup_library_items table
CREATE TABLE IF NOT EXISTS "mockup_library_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "preview_path" TEXT,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "view" "MockupLibraryView" NOT NULL,
  "scene_type" "MockupLibraryScene" NOT NULL,
  "render_mode" "MockupLibraryRenderMode" NOT NULL DEFAULT 'COMPOSITE',
  "composite_region_px" JSONB,
  "uploaded_by_id" TEXT,
  "mime_type" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mockup_library_items_pkey" PRIMARY KEY ("id")
);

-- 3. Create template_mockup_items table
CREATE TABLE IF NOT EXISTS "template_mockup_items" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "mockup_id" TEXT NOT NULL,
  "applies_to_color_ids" JSONB NOT NULL DEFAULT '[]',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "template_mockup_items_pkey" PRIMARY KEY ("id")
);

-- 4. Add foreign keys for new tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mockup_library_items_tenant_id_fkey') THEN
    ALTER TABLE "mockup_library_items"
      ADD CONSTRAINT "mockup_library_items_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mockup_library_items_uploaded_by_id_fkey') THEN
    ALTER TABLE "mockup_library_items"
      ADD CONSTRAINT "mockup_library_items_uploaded_by_id_fkey"
      FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_mockup_items_template_id_fkey') THEN
    ALTER TABLE "template_mockup_items"
      ADD CONSTRAINT "template_mockup_items_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "store_mockup_templates"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_mockup_items_mockup_id_fkey') THEN
    ALTER TABLE "template_mockup_items"
      ADD CONSTRAINT "template_mockup_items_mockup_id_fkey"
      FOREIGN KEY ("mockup_id") REFERENCES "mockup_library_items"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Create indexes for new tables
CREATE UNIQUE INDEX "template_mockup_items_template_id_mockup_id_key"
  ON "template_mockup_items"("template_id", "mockup_id");

CREATE UNIQUE INDEX "template_mockup_items_one_primary_per_template_idx"
  ON "template_mockup_items"("template_id")
  WHERE "is_primary" = true;

CREATE INDEX "mockup_library_items_tenant_id_is_active_deleted_at_idx"
  ON "mockup_library_items"("tenant_id", "is_active", "deleted_at");

CREATE INDEX "mockup_library_items_tenant_id_name_idx"
  ON "mockup_library_items"("tenant_id", "name");

CREATE INDEX "template_mockup_items_template_id_is_primary_sort_order_idx"
  ON "template_mockup_items"("template_id", "is_primary", "sort_order");

CREATE INDEX "template_mockup_items_mockup_id_idx"
  ON "template_mockup_items"("mockup_id");

-- 6. Rewire wizard_draft_mockup_library_picks: replace source_id with template_mockup_item_id
TRUNCATE TABLE "wizard_draft_mockup_library_picks";

ALTER TABLE "wizard_draft_mockup_library_picks"
  DROP CONSTRAINT IF EXISTS "wizard_draft_mockup_library_picks_source_id_fkey";

DROP INDEX IF EXISTS "wizard_draft_mockup_library_picks_wizard_draft_id_source_id_key";

ALTER TABLE "wizard_draft_mockup_library_picks"
  DROP COLUMN IF EXISTS "source_id";

ALTER TABLE "wizard_draft_mockup_library_picks"
  ADD COLUMN IF NOT EXISTS "template_mockup_item_id" TEXT;

-- Backfill guard: column must be NOT NULL, but after TRUNCATE there are no rows.
-- If rows existed, they'd need a valid template_mockup_item_id.

ALTER TABLE "wizard_draft_mockup_library_picks"
  ALTER COLUMN "template_mockup_item_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_draft_mockup_library_picks_template_mockup_item_id_fkey') THEN
    ALTER TABLE "wizard_draft_mockup_library_picks"
      ADD CONSTRAINT "wizard_draft_mockup_library_picks_template_mockup_item_id_fkey"
      FOREIGN KEY ("template_mockup_item_id") REFERENCES "template_mockup_items"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "wizard_draft_mockup_library_picks_draft_id_template_mockup_item_id_color_id_key"
  ON "wizard_draft_mockup_library_picks"("wizard_draft_id", "template_mockup_item_id", "color_id");

CREATE INDEX IF NOT EXISTS "wizard_draft_mockup_library_picks_template_mockup_item_id_idx"
  ON "wizard_draft_mockup_library_picks"("template_mockup_item_id");

-- 7. Remove legacy template default composite region
ALTER TABLE "store_mockup_templates"
  DROP COLUMN IF EXISTS "default_composite_region_px";

-- 8. Drop legacy custom_mockup_sources table
DROP TABLE IF EXISTS "custom_mockup_sources" CASCADE;

-- 9. Drop legacy enum types
DROP TYPE IF EXISTS "CustomMockupScope";
DROP TYPE IF EXISTS "CustomMockupView";
DROP TYPE IF EXISTS "CustomMockupScene";
DROP TYPE IF EXISTS "CustomRenderMode";
