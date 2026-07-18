-- AlterTable
ALTER TABLE "publish_attempts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "publish_outbox" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "publish_outbox_status_locked_at_idx" ON "publish_outbox"("status", "locked_at");

-- RenameIndex
ALTER INDEX "attempt_stage" RENAME TO "publish_jobs_publish_attempt_id_stage_key";
