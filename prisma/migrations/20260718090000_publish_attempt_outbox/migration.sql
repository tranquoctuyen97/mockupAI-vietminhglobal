-- Add durable publish attempt and outbox infrastructure.
-- This migration is intentionally additive: legacy publish_jobs keep
-- publish_attempt_id NULL until a reviewed backfill/recovery pass runs.

ALTER TABLE "listings"
ADD COLUMN "active_publish_attempt_id" TEXT;

ALTER TABLE "publish_jobs"
ADD COLUMN "publish_attempt_id" TEXT,
ADD COLUMN "next_retry_at" TIMESTAMP(3),
ADD COLUMN "reason_code" TEXT,
ADD COLUMN "last_error_code" TEXT;

CREATE TABLE "publish_attempts" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "baseline_listing_status" TEXT NOT NULL,
  "resume_from_attempt_id" TEXT,
  "first_external_write_started_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "publish_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publish_outbox" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "wizard_draft_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "publish_attempt_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by" TEXT,
  "locked_at" TIMESTAMP(3),
  "last_error" TEXT,
  "dispatched_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "publish_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "listings_active_publish_attempt_id_key"
ON "listings"("active_publish_attempt_id");

CREATE UNIQUE INDEX "publish_attempts_listing_id_attempt_no_key"
ON "publish_attempts"("listing_id", "attempt_no");

CREATE INDEX "publish_attempts_listing_id_status_idx"
ON "publish_attempts"("listing_id", "status");

CREATE INDEX "publish_jobs_listing_id_publish_attempt_id_idx"
ON "publish_jobs"("listing_id", "publish_attempt_id");

CREATE UNIQUE INDEX "attempt_stage"
ON "publish_jobs"("publish_attempt_id", "stage");

CREATE UNIQUE INDEX "publish_outbox_publish_attempt_id_key"
ON "publish_outbox"("publish_attempt_id");

CREATE INDEX "publish_outbox_status_next_attempt_at_idx"
ON "publish_outbox"("status", "next_attempt_at");

CREATE INDEX "publish_outbox_status_locked_at_idx"
ON "publish_outbox"("status", "locked_at");

ALTER TABLE "listings"
ADD CONSTRAINT "listings_active_publish_attempt_id_fkey"
FOREIGN KEY ("active_publish_attempt_id") REFERENCES "publish_attempts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "publish_attempts"
ADD CONSTRAINT "publish_attempts_listing_id_fkey"
FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publish_jobs"
ADD CONSTRAINT "publish_jobs_publish_attempt_id_fkey"
FOREIGN KEY ("publish_attempt_id") REFERENCES "publish_attempts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publish_outbox"
ADD CONSTRAINT "publish_outbox_publish_attempt_id_fkey"
FOREIGN KEY ("publish_attempt_id") REFERENCES "publish_attempts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
