-- AlterTable: Add store_id to mockup_library_items and set up foreign keys and indexes safely.

-- 1. Add store_id as a nullable column first so we can backfill existing rows
ALTER TABLE "mockup_library_items" ADD COLUMN IF NOT EXISTS "store_id" TEXT;

-- 2. Backfill store_id from template_mockup_items and store_mockup_templates
UPDATE "mockup_library_items" mli
SET "store_id" = smt."store_id"
FROM "template_mockup_items" tmi
JOIN "store_mockup_templates" smt ON tmi."template_id" = smt."id"
WHERE tmi."mockup_id" = mli."id"
  AND mli."store_id" IS NULL;

-- 3. If there are still nulls (e.g. orphaned mockups), fallback to the first store of the tenant
UPDATE "mockup_library_items" mli
SET "store_id" = (
  SELECT id FROM "stores" s WHERE s."tenant_id" = mli."tenant_id" LIMIT 1
)
WHERE mli."store_id" IS NULL;

-- 4. Enforce NOT NULL constraint
ALTER TABLE "mockup_library_items" ALTER COLUMN "store_id" SET NOT NULL;

-- 5. Add foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mockup_library_items_store_id_fkey') THEN
    ALTER TABLE "mockup_library_items"
      ADD CONSTRAINT "mockup_library_items_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Update indexes
DROP INDEX IF EXISTS "mockup_library_items_tenant_id_is_active_deleted_at_idx";
CREATE INDEX IF NOT EXISTS "mockup_library_items_tenant_id_store_id_is_active_deleted_at_idx"
  ON "mockup_library_items"("tenant_id", "store_id", "is_active", "deleted_at");
