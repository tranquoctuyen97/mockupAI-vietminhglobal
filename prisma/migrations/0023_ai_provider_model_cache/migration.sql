CREATE TABLE IF NOT EXISTS "ai_provider_model_cache" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "models_json" JSONB NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_provider_model_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_model_cache_tenant_id_provider_key"
  ON "ai_provider_model_cache"("tenant_id", "provider");

CREATE INDEX IF NOT EXISTS "ai_provider_model_cache_tenant_id_fetched_at_idx"
  ON "ai_provider_model_cache"("tenant_id", "fetched_at");
