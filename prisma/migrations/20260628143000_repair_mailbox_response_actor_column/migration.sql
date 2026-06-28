ALTER TABLE "mailbox_response_metrics"
  ADD COLUMN IF NOT EXISTS "latest_admin_reply_actor_user_id" TEXT;

CREATE INDEX IF NOT EXISTS "mailbox_response_metrics_latest_admin_reply_actor_user_id_response_started_at_idx"
  ON "mailbox_response_metrics"("latest_admin_reply_actor_user_id", "response_started_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mailbox_response_metrics_latest_admin_reply_actor_user_id_fkey'
  ) THEN
    ALTER TABLE "mailbox_response_metrics"
      ADD CONSTRAINT "mailbox_response_metrics_latest_admin_reply_actor_user_id_fkey"
      FOREIGN KEY ("latest_admin_reply_actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
