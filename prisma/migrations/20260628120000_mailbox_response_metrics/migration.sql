ALTER TABLE "gmail_message_links" ADD COLUMN "gmail_internal_date" TIMESTAMP(3);

CREATE TABLE "mailbox_response_metrics" (
  "conversation_id" TEXT NOT NULL,
  "mailbox_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "response_started_at" TIMESTAMP(3) NOT NULL,
  "latest_admin_reply_at" TIMESTAMP(3),
  "latest_admin_reply_actor_user_id" TEXT,
  "response_duration_ms" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mailbox_response_metrics_pkey" PRIMARY KEY ("conversation_id")
);

CREATE INDEX "mailbox_response_metrics_tenant_id_store_id_response_started_at_idx"
  ON "mailbox_response_metrics"("tenant_id", "store_id", "response_started_at");

CREATE INDEX "mailbox_response_metrics_mailbox_id_response_started_at_idx"
  ON "mailbox_response_metrics"("mailbox_id", "response_started_at");

CREATE INDEX "mailbox_response_metrics_latest_admin_reply_at_idx"
  ON "mailbox_response_metrics"("latest_admin_reply_at");

CREATE INDEX "mailbox_response_metrics_latest_admin_reply_actor_user_id_response_started_at_idx"
  ON "mailbox_response_metrics"("latest_admin_reply_actor_user_id", "response_started_at");

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_mailbox_id_fkey"
  FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_latest_admin_reply_actor_user_id_fkey"
  FOREIGN KEY ("latest_admin_reply_actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
