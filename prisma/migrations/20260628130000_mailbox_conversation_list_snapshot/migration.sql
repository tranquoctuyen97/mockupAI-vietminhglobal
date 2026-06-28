ALTER TABLE "mailbox_conversations"
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "article_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rt_status" TEXT,
  ADD COLUMN "rt_created_at" TIMESTAMP(3),
  ADD COLUMN "rt_last_updated_at" TIMESTAMP(3);

CREATE INDEX "mailbox_conversations_mailbox_id_rt_last_updated_at_idx"
  ON "mailbox_conversations"("mailbox_id", "rt_last_updated_at");
