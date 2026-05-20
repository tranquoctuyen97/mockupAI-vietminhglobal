ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "tw_timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles';

CREATE TABLE IF NOT EXISTS "triple_whale_credentials" (
  "store_id" TEXT NOT NULL,
  "api_key_encrypted" BYTEA NOT NULL,
  "encryption_key_id" TEXT NOT NULL,
  "custom_name" TEXT NOT NULL,
  "last_synced_at" TIMESTAMP(3),
  "sync_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "triple_whale_credentials_pkey" PRIMARY KEY ("store_id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triple_whale_credentials_store_id_fkey'
  ) THEN
    ALTER TABLE "triple_whale_credentials"
      ADD CONSTRAINT "triple_whale_credentials_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "triple_whale_daily_stats" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "order_revenue" DECIMAL(12, 2) NOT NULL,
  "net_profit" DECIMAL(12, 2) NOT NULL,
  "net_margin" DECIMAL(8, 4) NOT NULL,
  "orders" INTEGER NOT NULL,
  "payment_gateways" DECIMAL(12, 2) NOT NULL,
  "shipping" DECIMAL(12, 2) NOT NULL,
  "blended_ad_spend" DECIMAL(12, 2) NOT NULL,
  "cogs" DECIMAL(12, 2) NOT NULL,
  "total_cost" DECIMAL(12, 2) NOT NULL,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "triple_whale_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "triple_whale_daily_stats_store_id_date_key"
  ON "triple_whale_daily_stats"("store_id", "date");

CREATE INDEX IF NOT EXISTS "triple_whale_daily_stats_store_id_date_idx"
  ON "triple_whale_daily_stats"("store_id", "date");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triple_whale_daily_stats_store_id_fkey'
  ) THEN
    ALTER TABLE "triple_whale_daily_stats"
      ADD CONSTRAINT "triple_whale_daily_stats_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triple_whale_daily_stats_credential_store_id_fkey'
  ) THEN
    ALTER TABLE "triple_whale_daily_stats"
      ADD CONSTRAINT "triple_whale_daily_stats_credential_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "triple_whale_credentials"("store_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
