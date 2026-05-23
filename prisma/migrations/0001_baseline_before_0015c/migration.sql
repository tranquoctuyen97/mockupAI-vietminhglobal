-- Baseline schema recovered for repositories whose migration history starts at 0015c.
-- This migration is intentionally idempotent: existing dev/prod databases already have
-- these objects, while Prisma shadow databases need them before replaying 0015c+.

DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrintifyAccountStatus" AS ENUM ('ACTIVE', 'TOKEN_INVALID', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TemplatePosition" AS ENUM ('FRONT', 'BACK', 'SLEEVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DesignStatus" AS ENUM ('ACTIVE', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'PUBLISHED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ListingStatus" AS ENUM ('PUBLISHING', 'ACTIVE', 'PARTIAL_FAILURE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PublishStage" AS ENUM ('SHOPIFY', 'PRINTIFY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'FULFILLED', 'PARTIAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PlacementPosition" AS ENUM ('FRONT', 'BACK', 'SLEEVE_LEFT', 'SLEEVE_RIGHT', 'NECK_LABEL', 'HEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_tenant_id_idx" ON "users"("tenant_id");
CREATE INDEX IF NOT EXISTS "users_email_status_idx" ON "users"("email", "status");
CREATE INDEX IF NOT EXISTS "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "user_agent" TEXT,
  "ip" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE INDEX IF NOT EXISTS "sessions_token_hash_idx" ON "sessions"("token_hash");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_resource_type_resource_id_idx" ON "audit_events"("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "rollout_percent" INTEGER NOT NULL DEFAULT 100,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "feature_flags_enabled_idx" ON "feature_flags"("enabled");

CREATE TABLE IF NOT EXISTS "printify_accounts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "api_key_encrypted" BYTEA NOT NULL,
  "encryption_key_id" TEXT NOT NULL,
  "status" "PrintifyAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_sync_at" TIMESTAMP(3),
  "last_health_check" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printify_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "printify_accounts_tenant_id_nickname_key" ON "printify_accounts"("tenant_id", "nickname");
CREATE INDEX IF NOT EXISTS "printify_accounts_tenant_id_status_idx" ON "printify_accounts"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "printify_shops" (
  "id" TEXT NOT NULL,
  "printify_account_id" TEXT NOT NULL,
  "external_shop_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "sales_channel" TEXT,
  "external_domain" TEXT,
  "disconnected" BOOLEAN NOT NULL DEFAULT false,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printify_shops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "printify_shops_printify_account_id_external_shop_id_key"
  ON "printify_shops"("printify_account_id", "external_shop_id");

CREATE TABLE IF NOT EXISTS "stores" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shopify_domain" TEXT NOT NULL,
  "shopify_shop_id" TEXT,
  "printify_shop_id" TEXT,
  "printify_shop_title" TEXT,
  "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_health_check" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stores_printify_shop_id_key" ON "stores"("printify_shop_id");
CREATE UNIQUE INDEX IF NOT EXISTS "stores_tenant_id_shopify_domain_key" ON "stores"("tenant_id", "shopify_domain");
CREATE INDEX IF NOT EXISTS "stores_tenant_id_status_idx" ON "stores"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "store_credentials" (
  "store_id" TEXT NOT NULL,
  "shopify_client_id" TEXT NOT NULL,
  "shopify_client_secret_enc" BYTEA NOT NULL,
  "shopify_token_encrypted" BYTEA,
  "encryption_key_id" TEXT NOT NULL,
  "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_credentials_pkey" PRIMARY KEY ("store_id")
);

CREATE TABLE IF NOT EXISTS "store_colors" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hex" TEXT NOT NULL,
  "printify_color_id" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "store_colors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_colors_store_id_name_key" ON "store_colors"("store_id", "name");
CREATE INDEX IF NOT EXISTS "store_colors_store_id_idx" ON "store_colors"("store_id");

CREATE TABLE IF NOT EXISTS "store_mockup_templates" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "printify_blueprint_id" INTEGER NOT NULL,
  "printify_print_provider_id" INTEGER NOT NULL,
  "preview_url" TEXT,
  "position" "TemplatePosition" NOT NULL DEFAULT 'FRONT',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "print_areas_by_view" JSONB,
  "blueprint_image_url" TEXT,
  "blueprint_brand" TEXT,
  CONSTRAINT "store_mockup_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "store_mockup_templates_store_id_idx" ON "store_mockup_templates"("store_id");

CREATE TABLE IF NOT EXISTS "template_colors" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "color_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "template_colors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "template_colors_template_id_color_id_key" ON "template_colors"("template_id", "color_id");
CREATE INDEX IF NOT EXISTS "template_colors_template_id_idx" ON "template_colors"("template_id");

CREATE TABLE IF NOT EXISTS "designs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "preview_path" TEXT,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "dpi" INTEGER,
  "file_size_bytes" INTEGER NOT NULL,
  "mime_type" TEXT NOT NULL,
  "status" "DesignStatus" NOT NULL DEFAULT 'ACTIVE',
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "designs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "designs_tenant_id_status_idx" ON "designs"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "designs_tenant_id_name_idx" ON "designs"("tenant_id", "name");

CREATE TABLE IF NOT EXISTS "design_usage" (
  "design_id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  CONSTRAINT "design_usage_pkey" PRIMARY KEY ("design_id", "listing_id")
);

CREATE TABLE IF NOT EXISTS "wizard_drafts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "design_id" TEXT,
  "store_id" TEXT,
  "ai_content" JSONB,
  "current_step" INTEGER NOT NULL DEFAULT 1,
  "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "template_id" TEXT,
  CONSTRAINT "wizard_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wizard_drafts_tenant_id_updated_at_idx" ON "wizard_drafts"("tenant_id", "updated_at");

CREATE TABLE IF NOT EXISTS "mockup_jobs" (
  "id" TEXT NOT NULL,
  "wizard_draft_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "total_images" INTEGER NOT NULL DEFAULT 0,
  "completed_images" INTEGER NOT NULL DEFAULT 0,
  "failed_images" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "placement_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mockup_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mockup_jobs_wizard_draft_id_status_idx" ON "mockup_jobs"("wizard_draft_id", "status");

CREATE TABLE IF NOT EXISTS "mockup_images" (
  "id" TEXT NOT NULL,
  "mockup_job_id" TEXT NOT NULL,
  "printify_mockup_id" TEXT NOT NULL,
  "variant_id" INTEGER NOT NULL,
  "color_name" TEXT NOT NULL,
  "view_position" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "composite_url" TEXT,
  "composite_status" TEXT NOT NULL DEFAULT 'pending',
  "composite_error" TEXT,
  "included" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mockup_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mockup_images_mockup_job_id_variant_id_idx" ON "mockup_images"("mockup_job_id", "variant_id");

CREATE TABLE IF NOT EXISTS "ai_content_cache" (
  "cache_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "tokens_in" INTEGER NOT NULL,
  "tokens_out" INTEGER NOT NULL,
  "cost_usd" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_content_cache_pkey" PRIMARY KEY ("cache_key")
);

CREATE INDEX IF NOT EXISTS "ai_content_cache_provider_created_at_idx" ON "ai_content_cache"("provider", "created_at");

CREATE TABLE IF NOT EXISTS "product_pricing_templates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "product_type" TEXT NOT NULL,
  "base_price_usd" DOUBLE PRECISION NOT NULL,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_pricing_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_pricing_templates_tenant_id_product_type_key"
  ON "product_pricing_templates"("tenant_id", "product_type");

CREATE TABLE IF NOT EXISTS "ai_settings" (
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'gemini',
  "model" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  "api_key_encrypted" BYTEA,
  "encryption_key_id" TEXT,
  "prompt_version" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE IF NOT EXISTS "listings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT,
  "design_id" TEXT,
  "template_id" TEXT,
  "wizard_draft_id" TEXT,
  "shopify_product_id" TEXT,
  "printify_product_id" TEXT,
  "status" "ListingStatus" NOT NULL DEFAULT 'PUBLISHING',
  "title" TEXT NOT NULL,
  "description_html" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "price_usd" DOUBLE PRECISION NOT NULL,
  "published_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "listings_wizard_draft_id_key" ON "listings"("wizard_draft_id");
CREATE INDEX IF NOT EXISTS "listings_tenant_id_status_idx" ON "listings"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "listings_store_id_idx" ON "listings"("store_id");

CREATE TABLE IF NOT EXISTS "listing_variants" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "color_name" TEXT NOT NULL,
  "color_hex" TEXT NOT NULL,
  "size" TEXT NOT NULL DEFAULT 'ONE_SIZE',
  "shopify_variant_id" TEXT,
  "printify_variant_id" TEXT,
  "sku" TEXT,
  CONSTRAINT "listing_variants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "listing_variants_listing_id_idx" ON "listing_variants"("listing_id");

CREATE TABLE IF NOT EXISTS "publish_jobs" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "stage" "PublishStage" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "publish_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "publish_jobs_idempotency_key_key" ON "publish_jobs"("idempotency_key");
CREATE INDEX IF NOT EXISTS "publish_jobs_listing_id_idx" ON "publish_jobs"("listing_id");

CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "listing_id" TEXT,
  "shopify_order_id" TEXT NOT NULL,
  "shopify_order_number" TEXT,
  "customer_email" TEXT,
  "total_usd" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "fulfillment_status" "FulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
  "printify_order_id" TEXT,
  "printify_status" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "orders_shopify_order_id_key" ON "orders"("shopify_order_id");
CREATE INDEX IF NOT EXISTS "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "orders_store_id_idx" ON "orders"("store_id");
CREATE INDEX IF NOT EXISTS "orders_listing_id_idx" ON "orders"("listing_id");

CREATE TABLE IF NOT EXISTS "order_line_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "listing_variant_id" TEXT,
  "title" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "price_usd" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "order_line_items_order_id_idx" ON "order_line_items"("order_id");

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "signature_valid" BOOLEAN NOT NULL,
  "payload" JSONB NOT NULL,
  "processed_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_events_source_topic_external_id_idx" ON "webhook_events"("source", "topic", "external_id");

CREATE TABLE IF NOT EXISTS "placement_presets" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_vi" TEXT,
  "position" "PlacementPosition" NOT NULL DEFAULT 'FRONT',
  "product_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "default_x_mm" DOUBLE PRECISION NOT NULL,
  "default_y_mm" DOUBLE PRECISION NOT NULL,
  "default_width_mm" DOUBLE PRECISION NOT NULL,
  "default_height_mm" DOUBLE PRECISION NOT NULL,
  "icon_svg" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "placement_presets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "placement_presets_tenant_id_key_key" ON "placement_presets"("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "placement_presets_position_idx" ON "placement_presets"("position");

CREATE TABLE IF NOT EXISTS "blueprint_print_areas" (
  "id" TEXT NOT NULL,
  "printify_blueprint_id" INTEGER NOT NULL,
  "position" "PlacementPosition" NOT NULL DEFAULT 'FRONT',
  "width_mm" DOUBLE PRECISION NOT NULL,
  "height_mm" DOUBLE PRECISION NOT NULL,
  "safe_margin_mm" DOUBLE PRECISION NOT NULL DEFAULT 3,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blueprint_print_areas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "blueprint_print_areas_printify_blueprint_id_key"
  ON "blueprint_print_areas"("printify_blueprint_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_fkey') THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_user_id_fkey') THEN
    ALTER TABLE "sessions"
      ADD CONSTRAINT "sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_tenant_id_fkey') THEN
    ALTER TABLE "audit_events"
      ADD CONSTRAINT "audit_events_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'printify_shops_printify_account_id_fkey') THEN
    ALTER TABLE "printify_shops"
      ADD CONSTRAINT "printify_shops_printify_account_id_fkey"
      FOREIGN KEY ("printify_account_id") REFERENCES "printify_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_tenant_id_fkey') THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_printify_shop_id_fkey') THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_printify_shop_id_fkey"
      FOREIGN KEY ("printify_shop_id") REFERENCES "printify_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_credentials_store_id_fkey') THEN
    ALTER TABLE "store_credentials"
      ADD CONSTRAINT "store_credentials_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_colors_store_id_fkey') THEN
    ALTER TABLE "store_colors"
      ADD CONSTRAINT "store_colors_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_mockup_templates_store_id_fkey') THEN
    ALTER TABLE "store_mockup_templates"
      ADD CONSTRAINT "store_mockup_templates_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_colors_template_id_fkey') THEN
    ALTER TABLE "template_colors"
      ADD CONSTRAINT "template_colors_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "store_mockup_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_colors_color_id_fkey') THEN
    ALTER TABLE "template_colors"
      ADD CONSTRAINT "template_colors_color_id_fkey"
      FOREIGN KEY ("color_id") REFERENCES "store_colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'design_usage_design_id_fkey') THEN
    ALTER TABLE "design_usage"
      ADD CONSTRAINT "design_usage_design_id_fkey"
      FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_drafts_design_id_fkey') THEN
    ALTER TABLE "wizard_drafts"
      ADD CONSTRAINT "wizard_drafts_design_id_fkey"
      FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_drafts_tenant_id_fkey') THEN
    ALTER TABLE "wizard_drafts"
      ADD CONSTRAINT "wizard_drafts_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_drafts_store_id_fkey') THEN
    ALTER TABLE "wizard_drafts"
      ADD CONSTRAINT "wizard_drafts_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wizard_drafts_template_id_fkey') THEN
    ALTER TABLE "wizard_drafts"
      ADD CONSTRAINT "wizard_drafts_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "store_mockup_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mockup_jobs_wizard_draft_id_fkey') THEN
    ALTER TABLE "mockup_jobs"
      ADD CONSTRAINT "mockup_jobs_wizard_draft_id_fkey"
      FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mockup_images_mockup_job_id_fkey') THEN
    ALTER TABLE "mockup_images"
      ADD CONSTRAINT "mockup_images_mockup_job_id_fkey"
      FOREIGN KEY ("mockup_job_id") REFERENCES "mockup_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_store_id_fkey') THEN
    ALTER TABLE "listings"
      ADD CONSTRAINT "listings_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_template_id_fkey') THEN
    ALTER TABLE "listings"
      ADD CONSTRAINT "listings_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "store_mockup_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listing_variants_listing_id_fkey') THEN
    ALTER TABLE "listing_variants"
      ADD CONSTRAINT "listing_variants_listing_id_fkey"
      FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_jobs_listing_id_fkey') THEN
    ALTER TABLE "publish_jobs"
      ADD CONSTRAINT "publish_jobs_listing_id_fkey"
      FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_line_items_order_id_fkey') THEN
    ALTER TABLE "order_line_items"
      ADD CONSTRAINT "order_line_items_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
