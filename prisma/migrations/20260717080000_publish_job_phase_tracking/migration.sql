ALTER TABLE "publish_jobs"
  ADD COLUMN "phase" TEXT,
  ADD COLUMN "progress_message" TEXT,
  ADD COLUMN "progress_data" JSONB,
  ADD COLUMN "phase_started_at" TIMESTAMP(3);
