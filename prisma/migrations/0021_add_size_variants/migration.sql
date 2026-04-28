-- Store template: thêm enabledSizes
ALTER TABLE "store_mockup_templates"
  ADD COLUMN "enabled_sizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- WizardDraft: thêm enabledSizes (subset của template.enabledSizes)
ALTER TABLE "wizard_drafts"
  ADD COLUMN "enabled_sizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Cache Printify variant cost data per (blueprint, provider, variant)
-- để tránh fetch Printify API mỗi lần publish (rate limit)
CREATE TABLE "printify_variant_cache" (
  "blueprint_id"        INT NOT NULL,
  "print_provider_id"   INT NOT NULL,
  "variant_id"          INT NOT NULL,
  "color_name"          TEXT NOT NULL,
  "color_hex"           TEXT,
  "size"                TEXT NOT NULL,
  "sku"                 TEXT,
  "cost_cents"          INT NOT NULL DEFAULT 0,
  "is_available"        BOOLEAN NOT NULL DEFAULT TRUE,
  "fetched_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "printify_variant_cache_pkey" PRIMARY KEY ("blueprint_id", "print_provider_id", "variant_id")
);

CREATE INDEX "idx_printify_variant_cache_lookup"
  ON "printify_variant_cache" ("blueprint_id", "print_provider_id");
