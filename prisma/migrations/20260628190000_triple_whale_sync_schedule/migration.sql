ALTER TABLE "triple_whale_credentials"
  ADD COLUMN "sync_from_date" DATE,
  ADD COLUMN "sync_interval_minutes" INTEGER NOT NULL DEFAULT 30;

UPDATE "triple_whale_credentials"
SET "sync_from_date" = (CURRENT_DATE - INTERVAL '90 days')::date
WHERE "sync_from_date" IS NULL;

ALTER TABLE "triple_whale_credentials"
  ALTER COLUMN "sync_from_date" SET NOT NULL;

ALTER TABLE "triple_whale_credentials"
  ADD CONSTRAINT "triple_whale_credentials_sync_interval_minutes_min"
  CHECK ("sync_interval_minutes" >= 30);
