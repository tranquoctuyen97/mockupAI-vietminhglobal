-- Custom Mockup Library Rev 3: Scope-aware custom mockup sources
-- Adds TEMPLATE and DRAFT scopes, wizard source mode, and library picks

-- 1. Create new enum types
DO $$ BEGIN
  CREATE TYPE "CustomMockupScope" AS ENUM ('TEMPLATE', 'DRAFT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WizardMockupSourceMode" AS ENUM ('AUTO', 'TEMPLATE_PRINTIFY', 'DRAFT_CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add new columns to custom_mockup_sources
ALTER TABLE "custom_mockup_sources"
  ADD COLUMN IF NOT EXISTS "scope" "CustomMockupScope" NOT NULL DEFAULT 'TEMPLATE',
  ADD COLUMN IF NOT EXISTS "store_id" TEXT,
  ADD COLUMN IF NOT EXISTS "wizard_draft_id" TEXT;

-- 3. Backfill store_id from store_mockup_templates
UPDATE "custom_mockup_sources" cms
SET "store_id" = smt."store_id"
FROM "store_mockup_templates" smt
WHERE cms."template_id" = smt."id"
  AND cms."store_id" IS NULL;

-- 4. Guard check: verify all rows have store_id after backfill
DO $$
DECLARE
  unmapped_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmapped_count
  FROM "custom_mockup_sources"
  WHERE "store_id" IS NULL;

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Migration guard failed: % custom_mockup_sources row(s) could not be mapped to a store_id via store_mockup_templates. Fix orphaned rows before retrying.', unmapped_count;
  END IF;
END $$;

-- 5. Apply NOT NULL and DROP NOT NULL constraints
ALTER TABLE "custom_mockup_sources"
  ALTER COLUMN "store_id" SET NOT NULL,
  ALTER COLUMN "template_id" DROP NOT NULL;

-- 6. Add foreign keys for new columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_mockup_sources_store_id_fkey') THEN
    ALTER TABLE "custom_mockup_sources"
      ADD CONSTRAINT "custom_mockup_sources_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_mockup_sources_wizard_draft_id_fkey') THEN
    ALTER TABLE "custom_mockup_sources"
      ADD CONSTRAINT "custom_mockup_sources_wizard_draft_id_fkey"
      FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 7. Update indexes: drop old, add scope-aware indexes
DROP INDEX IF EXISTS "custom_mockup_sources_template_id_color_id_is_active_idx";

CREATE INDEX IF NOT EXISTS "custom_mockup_sources_scope_store_id_template_id_color_id_is_active_idx"
  ON "custom_mockup_sources"("scope", "store_id", "template_id", "color_id", "is_active");

CREATE INDEX IF NOT EXISTS "custom_mockup_sources_scope_wizard_draft_id_color_id_is_active_idx"
  ON "custom_mockup_sources"("scope", "wizard_draft_id", "color_id", "is_active");

-- 8. Add mockup_source_mode to wizard_drafts
ALTER TABLE "wizard_drafts"
  ADD COLUMN IF NOT EXISTS "mockup_source_mode" "WizardMockupSourceMode" NOT NULL DEFAULT 'AUTO';

-- 9. Create wizard_draft_mockup_library_picks table
CREATE TABLE IF NOT EXISTS "wizard_draft_mockup_library_picks" (
  "id" TEXT NOT NULL,
  "wizard_draft_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "color_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wizard_draft_mockup_library_picks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wizard_draft_mockup_library_picks_wizard_draft_id_source_id_key"
  ON "wizard_draft_mockup_library_picks"("wizard_draft_id", "source_id");

CREATE INDEX IF NOT EXISTS "wizard_draft_mockup_library_picks_wizard_draft_id_color_id_idx"
  ON "wizard_draft_mockup_library_picks"("wizard_draft_id", "color_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_draft_mockup_library_picks_wizard_draft_id_fkey') THEN
    ALTER TABLE "wizard_draft_mockup_library_picks"
      ADD CONSTRAINT "wizard_draft_mockup_library_picks_wizard_draft_id_fkey"
      FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_draft_mockup_library_picks_source_id_fkey') THEN
    ALTER TABLE "wizard_draft_mockup_library_picks"
      ADD CONSTRAINT "wizard_draft_mockup_library_picks_source_id_fkey"
      FOREIGN KEY ("source_id") REFERENCES "custom_mockup_sources"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_draft_mockup_library_picks_color_id_fkey') THEN
    ALTER TABLE "wizard_draft_mockup_library_picks"
      ADD CONSTRAINT "wizard_draft_mockup_library_picks_color_id_fkey"
      FOREIGN KEY ("color_id") REFERENCES "store_colors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
