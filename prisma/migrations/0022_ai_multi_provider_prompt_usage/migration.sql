-- AI settings v2: real multi-provider config, tenant prompt editor, and token usage events.

CREATE TABLE IF NOT EXISTS "ai_provider_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "api_key_encrypted" BYTEA,
  "encryption_key_id" TEXT,
  "configured" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_provider_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_settings_tenant_id_provider_key"
  ON "ai_provider_settings" ("tenant_id", "provider");

CREATE INDEX IF NOT EXISTS "ai_provider_settings_tenant_id_configured_idx"
  ON "ai_provider_settings" ("tenant_id", "configured");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_settings'
      AND column_name = 'api_key_encrypted'
  ) THEN
    INSERT INTO "ai_provider_settings" (
      "id",
      "tenant_id",
      "provider",
      "model",
      "api_key_encrypted",
      "encryption_key_id",
      "configured",
      "created_at",
      "updated_at"
    )
    SELECT
      'migrated_' || "tenant_id" || '_' || COALESCE("provider", 'gemini'),
      "tenant_id",
      COALESCE("provider", 'gemini'),
      COALESCE("model", 'gemini-2.5-flash'),
      "api_key_encrypted",
      "encryption_key_id",
      true,
      COALESCE("updated_at", CURRENT_TIMESTAMP),
      COALESCE("updated_at", CURRENT_TIMESTAMP)
    FROM "ai_settings"
    WHERE "api_key_encrypted" IS NOT NULL
    ON CONFLICT ("tenant_id", "provider") DO UPDATE SET
      "model" = EXCLUDED."model",
      "api_key_encrypted" = EXCLUDED."api_key_encrypted",
      "encryption_key_id" = EXCLUDED."encryption_key_id",
      "configured" = true,
      "updated_at" = EXCLUDED."updated_at";
  END IF;
END $$;

ALTER TABLE "ai_settings"
  ADD COLUMN IF NOT EXISTS "active_provider" TEXT NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS "system_prompt" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_settings'
      AND column_name = 'provider'
  ) THEN
    UPDATE "ai_settings"
    SET "active_provider" = COALESCE("provider", 'gemini')
    WHERE "active_provider" IS NULL OR "active_provider" = 'gemini';
  END IF;
END $$;

ALTER TABLE "ai_settings"
  DROP COLUMN IF EXISTS "provider",
  DROP COLUMN IF EXISTS "model",
  DROP COLUMN IF EXISTS "api_key_encrypted",
  DROP COLUMN IF EXISTS "encryption_key_id",
  DROP COLUMN IF EXISTS "prompt_version";

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "wizard_draft_id" TEXT,
  "status" TEXT NOT NULL,
  "cache_hit" BOOLEAN NOT NULL DEFAULT false,
  "tokens_in" INTEGER NOT NULL DEFAULT 0,
  "tokens_out" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_usage_events_tenant_id_created_at_idx"
  ON "ai_usage_events" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "ai_usage_events_tenant_id_provider_created_at_idx"
  ON "ai_usage_events" ("tenant_id", "provider", "created_at");

CREATE INDEX IF NOT EXISTS "ai_usage_events_wizard_draft_id_idx"
  ON "ai_usage_events" ("wizard_draft_id");

ALTER TABLE "ai_content_cache"
  DROP COLUMN IF EXISTS "cost_usd";

ALTER TABLE "store_mockup_templates"
  DROP COLUMN IF EXISTS "default_prompt_version";
