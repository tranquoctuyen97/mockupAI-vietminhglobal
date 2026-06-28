-- Add persisted mailbox internal notes and composer attachments.

CREATE TABLE "mailbox_internal_notes" (
  "id" TEXT NOT NULL,
  "mailbox_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mailbox_internal_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_composer_attachments" (
  "id" TEXT NOT NULL,
  "mailbox_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "uploaded_by_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "storage_path" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'READY',
  "gmail_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mailbox_composer_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mailbox_internal_notes_conversation_id_created_at_idx"
  ON "mailbox_internal_notes"("conversation_id", "created_at");

CREATE INDEX "mailbox_internal_notes_mailbox_id_created_at_idx"
  ON "mailbox_internal_notes"("mailbox_id", "created_at");

CREATE INDEX "mailbox_composer_attachments_conversation_id_state_idx"
  ON "mailbox_composer_attachments"("conversation_id", "state");

CREATE INDEX "mailbox_composer_attachments_mailbox_id_created_at_idx"
  ON "mailbox_composer_attachments"("mailbox_id", "created_at");

ALTER TABLE "mailbox_internal_notes"
  ADD CONSTRAINT "mailbox_internal_notes_mailbox_id_fkey"
  FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_internal_notes"
  ADD CONSTRAINT "mailbox_internal_notes_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_internal_notes"
  ADD CONSTRAINT "mailbox_internal_notes_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_composer_attachments"
  ADD CONSTRAINT "mailbox_composer_attachments_mailbox_id_fkey"
  FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_composer_attachments"
  ADD CONSTRAINT "mailbox_composer_attachments_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_composer_attachments"
  ADD CONSTRAINT "mailbox_composer_attachments_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
