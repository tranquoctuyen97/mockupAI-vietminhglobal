CREATE TABLE "mailbox_skipped_senders" (
  "id" TEXT NOT NULL,
  "mailbox_id" TEXT NOT NULL,
  "sender_email" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mailbox_skipped_senders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mailbox_skipped_senders_mailbox_id_sender_email_key"
  ON "mailbox_skipped_senders"("mailbox_id", "sender_email");

CREATE INDEX "mailbox_skipped_senders_created_by_id_created_at_idx"
  ON "mailbox_skipped_senders"("created_by_id", "created_at");

ALTER TABLE "mailbox_skipped_senders"
  ADD CONSTRAINT "mailbox_skipped_senders_mailbox_id_fkey"
  FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_skipped_senders"
  ADD CONSTRAINT "mailbox_skipped_senders_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
