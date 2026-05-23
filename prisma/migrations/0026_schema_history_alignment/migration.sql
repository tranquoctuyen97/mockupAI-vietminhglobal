-- Align migration history with the schema that had previously been managed by db push.
-- This migration is intentionally idempotent so existing Neon data can be marked as applied.

ALTER TABLE "ai_provider_settings" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ai_settings" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "designs" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "feature_flags" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "mockup_images" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "mockup_jobs" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "product_pricing_templates" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "wizard_drafts" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "listings" ALTER COLUMN "tags" DROP DEFAULT;
ALTER TABLE "placement_presets" ALTER COLUMN "product_types" DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'fulfillment_status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'fulfillmentStatus'
  ) THEN
    ALTER TABLE "orders" RENAME COLUMN "fulfillment_status" TO "fulfillmentStatus";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'idx_printify_variant_cache_lookup'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'printify_variant_cache_blueprint_id_print_provider_id_idx'
  ) THEN
    ALTER INDEX "idx_printify_variant_cache_lookup"
      RENAME TO "printify_variant_cache_blueprint_id_print_provider_id_idx";
  END IF;
END $$;

UPDATE "store_colors" SET "enabled" = true WHERE "enabled" IS NULL;
ALTER TABLE "store_colors" ALTER COLUMN "enabled" SET NOT NULL;

UPDATE "store_mockup_templates" SET "default_aspect_ratio" = '1:1' WHERE "default_aspect_ratio" IS NULL;
UPDATE "store_mockup_templates" SET "blueprint_title" = '' WHERE "blueprint_title" IS NULL;
UPDATE "store_mockup_templates" SET "print_provider_title" = '' WHERE "print_provider_title" IS NULL;
UPDATE "store_mockup_templates" SET "schema_version" = 1 WHERE "schema_version" IS NULL;
ALTER TABLE "store_mockup_templates"
  ALTER COLUMN "default_aspect_ratio" SET NOT NULL,
  ALTER COLUMN "blueprint_title" SET NOT NULL,
  ALTER COLUMN "print_provider_title" SET NOT NULL,
  ALTER COLUMN "schema_version" SET NOT NULL;

ALTER TABLE "stores"
  DROP COLUMN IF EXISTS "enabled_variant_ids",
  DROP COLUMN IF EXISTS "default_prompt_version";

ALTER TABLE "stores" ALTER COLUMN "updated_at" DROP DEFAULT;
UPDATE "stores" SET "default_price_usd" = 24.99 WHERE "default_price_usd" IS NULL;
UPDATE "stores" SET "publish_mode" = 'draft' WHERE "publish_mode" IS NULL;
ALTER TABLE "stores"
  ALTER COLUMN "default_price_usd" SET NOT NULL,
  ALTER COLUMN "publish_mode" SET NOT NULL;

-- Triple Whale changed from store-scoped credentials to tenant + free-form shop domain.
ALTER TABLE "triple_whale_credentials"
  ADD COLUMN IF NOT EXISTS "id" TEXT,
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shop_domain" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'triple_whale_credentials'
      AND column_name = 'store_id'
  ) THEN
    UPDATE "triple_whale_credentials"
    SET "id" = 'twc_' || substr(md5(COALESCE("store_id", "tenant_id", "shop_domain", random()::text)), 1, 24)
    WHERE "id" IS NULL;
  ELSE
    UPDATE "triple_whale_credentials"
    SET "id" = 'twc_' || substr(md5(COALESCE("tenant_id", "shop_domain", random()::text)), 1, 24)
    WHERE "id" IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'triple_whale_credentials'
      AND column_name = 'store_id'
  ) THEN
    UPDATE "triple_whale_credentials" c
    SET
      "tenant_id" = COALESCE(c."tenant_id", s."tenant_id"),
      "shop_domain" = COALESCE(c."shop_domain", s."shopify_domain")
    FROM "stores" s
    WHERE c."store_id" = s."id";
  END IF;
END $$;

ALTER TABLE "triple_whale_daily_stats"
  ADD COLUMN IF NOT EXISTS "credential_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'triple_whale_daily_stats'
      AND column_name = 'store_id'
  ) THEN
    UPDATE "triple_whale_daily_stats" s
    SET "credential_id" = COALESCE(s."credential_id", c."id")
    FROM "triple_whale_credentials" c
    WHERE s."store_id" = c."store_id";
  END IF;
END $$;

ALTER TABLE "triple_whale_daily_stats"
  DROP CONSTRAINT IF EXISTS "triple_whale_daily_stats_credential_store_id_fkey",
  DROP CONSTRAINT IF EXISTS "triple_whale_daily_stats_store_id_fkey";

ALTER TABLE "triple_whale_credentials"
  DROP CONSTRAINT IF EXISTS "triple_whale_credentials_store_id_fkey";

DROP INDEX IF EXISTS "triple_whale_daily_stats_store_id_date_key";
DROP INDEX IF EXISTS "triple_whale_daily_stats_store_id_date_idx";

ALTER TABLE "triple_whale_credentials"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "tenant_id" SET NOT NULL,
  ALTER COLUMN "shop_domain" SET NOT NULL,
  ALTER COLUMN "updated_at" DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'triple_whale_credentials'
      AND c.conname = 'triple_whale_credentials_pkey'
      AND pg_get_constraintdef(c.oid) <> 'PRIMARY KEY (id)'
  ) THEN
    ALTER TABLE "triple_whale_credentials"
      DROP CONSTRAINT "triple_whale_credentials_pkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'triple_whale_credentials'
      AND c.conname = 'triple_whale_credentials_pkey'
  ) THEN
    ALTER TABLE "triple_whale_credentials"
      ADD CONSTRAINT "triple_whale_credentials_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

ALTER TABLE "triple_whale_daily_stats"
  ALTER COLUMN "credential_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "triple_whale_credentials_tenant_id_shop_domain_key"
  ON "triple_whale_credentials"("tenant_id", "shop_domain");

CREATE INDEX IF NOT EXISTS "triple_whale_credentials_tenant_id_idx"
  ON "triple_whale_credentials"("tenant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "triple_whale_daily_stats_credential_id_date_key"
  ON "triple_whale_daily_stats"("credential_id", "date");

CREATE INDEX IF NOT EXISTS "triple_whale_daily_stats_credential_id_date_idx"
  ON "triple_whale_daily_stats"("credential_id", "date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triple_whale_credentials_tenant_id_fkey'
  ) THEN
    ALTER TABLE "triple_whale_credentials"
      ADD CONSTRAINT "triple_whale_credentials_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triple_whale_daily_stats_credential_id_fkey'
  ) THEN
    ALTER TABLE "triple_whale_daily_stats"
      ADD CONSTRAINT "triple_whale_daily_stats_credential_id_fkey"
      FOREIGN KEY ("credential_id") REFERENCES "triple_whale_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "triple_whale_daily_stats"
  DROP COLUMN IF EXISTS "store_id";

ALTER TABLE "triple_whale_credentials"
  DROP COLUMN IF EXISTS "store_id";
