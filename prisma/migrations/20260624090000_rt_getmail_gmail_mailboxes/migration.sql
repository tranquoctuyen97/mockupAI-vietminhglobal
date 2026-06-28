-- Cleanup from deleted migrations (20260529173034_add_zammad_and_mailbox, 20260620090000_store_scoped_mailboxes)
-- Ensures migration is idempotent on DBs that had the old mailboxes table
DROP TABLE IF EXISTS "user_mailbox_access" CASCADE;
DROP TABLE IF EXISTS "zammad_users" CASCADE;
DROP TABLE IF EXISTS "mailboxes" CASCADE;

-- Drop ENUMs in case this migration failed partway through on a previous run
DROP TYPE IF EXISTS "MailboxSyncStatus" CASCADE;
DROP TYPE IF EXISTS "GmailLabelType" CASCADE;
DROP TYPE IF EXISTS "GmailLabelState" CASCADE;
DROP TYPE IF EXISTS "GmailMessageDirection" CASCADE;
DROP TYPE IF EXISTS "GmailLabelOperationType" CASCADE;
DROP TYPE IF EXISTS "GmailLabelOperationState" CASCADE;

-- CreateEnum
CREATE TYPE "MailboxSyncStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'DEGRADED', 'DISABLED');
CREATE TYPE "GmailLabelType" AS ENUM ('USER', 'INBOX', 'IMPORTANT', 'STARRED');
CREATE TYPE "GmailLabelState" AS ENUM ('ACTIVE', 'PENDING_CREATE', 'PENDING_RENAME', 'PENDING_DELETE', 'FAILED');
CREATE TYPE "GmailMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "GmailLabelOperationType" AS ENUM ('CREATE', 'RENAME', 'DELETE', 'ASSIGN', 'UNASSIGN');
CREATE TYPE "GmailLabelOperationState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "rt_queue_id" INTEGER,
    "app_password_encrypted" BYTEA NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "initial_sync_after" TIMESTAMP(3) NOT NULL,
    "sync_status" "MailboxSyncStatus" NOT NULL DEFAULT 'PROVISIONING',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error_code" TEXT,
    "provisioning_version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_sync_cursors" (
    "mailbox_id" TEXT NOT NULL,
    "uid_validity" BIGINT,
    "last_committed_uid" BIGINT NOT NULL DEFAULT 0,
    "last_reconciled_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    CONSTRAINT "mailbox_sync_cursors_pkey" PRIMARY KEY ("mailbox_id")
);

CREATE TABLE "gmail_labels" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "type" "GmailLabelType" NOT NULL,
    "is_mutable" BOOLEAN NOT NULL DEFAULT true,
    "state" "GmailLabelState" NOT NULL DEFAULT 'ACTIVE',
    "last_error_code" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gmail_labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_conversations" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "rt_ticket_id" INTEGER NOT NULL,
    "gmail_thread_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_activity_at" TIMESTAMP(3),
    "sync_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mailbox_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gmail_message_links" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "gmail_message_id" TEXT NOT NULL,
    "gmail_thread_id" TEXT NOT NULL,
    "rfc_message_id" TEXT,
    "imap_uid" BIGINT NOT NULL,
    "uid_validity" BIGINT NOT NULL,
    "rt_ticket_id" INTEGER,
    "rt_transaction_id" INTEGER,
    "direction" "GmailMessageDirection" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gmail_message_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_labels" (
    "conversation_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("conversation_id", "label_id")
);

CREATE TABLE "gmail_label_operations" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "label_id" TEXT,
    "actor_user_id" TEXT,
    "type" "GmailLabelOperationType" NOT NULL,
    "desired_payload" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "state" "GmailLabelOperationState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "error_code" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gmail_label_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_rt_queue_id_key" ON "mailboxes"("rt_queue_id");
CREATE INDEX "mailboxes_tenant_id_store_id_is_active_idx" ON "mailboxes"("tenant_id", "store_id", "is_active");
CREATE INDEX "mailboxes_sync_status_is_active_idx" ON "mailboxes"("sync_status", "is_active");
CREATE UNIQUE INDEX "mailboxes_tenant_id_email_key" ON "mailboxes"("tenant_id", "email");
CREATE INDEX "gmail_labels_mailbox_id_state_idx" ON "gmail_labels"("mailbox_id", "state");
CREATE UNIQUE INDEX "gmail_labels_mailbox_id_normalized_name_key" ON "gmail_labels"("mailbox_id", "normalized_name");
CREATE INDEX "mailbox_conversations_mailbox_id_status_last_activity_at_idx" ON "mailbox_conversations"("mailbox_id", "status", "last_activity_at");
CREATE UNIQUE INDEX "mailbox_conversations_mailbox_id_rt_ticket_id_key" ON "mailbox_conversations"("mailbox_id", "rt_ticket_id");
CREATE UNIQUE INDEX "mailbox_conversations_mailbox_id_gmail_thread_id_key" ON "mailbox_conversations"("mailbox_id", "gmail_thread_id");
CREATE INDEX "gmail_message_links_mailbox_id_gmail_thread_id_idx" ON "gmail_message_links"("mailbox_id", "gmail_thread_id");
CREATE INDEX "gmail_message_links_mailbox_id_rfc_message_id_idx" ON "gmail_message_links"("mailbox_id", "rfc_message_id");
CREATE UNIQUE INDEX "gmail_message_links_mailbox_id_gmail_message_id_key" ON "gmail_message_links"("mailbox_id", "gmail_message_id");
CREATE UNIQUE INDEX "gmail_message_links_mailbox_id_uid_validity_imap_uid_key" ON "gmail_message_links"("mailbox_id", "uid_validity", "imap_uid");
CREATE UNIQUE INDEX "gmail_message_links_mailbox_id_rt_transaction_id_key" ON "gmail_message_links"("mailbox_id", "rt_transaction_id");
CREATE INDEX "conversation_labels_label_id_conversation_id_idx" ON "conversation_labels"("label_id", "conversation_id");
CREATE UNIQUE INDEX "gmail_label_operations_idempotency_key_key" ON "gmail_label_operations"("idempotency_key");
CREATE INDEX "gmail_label_operations_state_next_attempt_at_idx" ON "gmail_label_operations"("state", "next_attempt_at");
CREATE INDEX "gmail_label_operations_mailbox_id_created_at_idx" ON "gmail_label_operations"("mailbox_id", "created_at");

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_sync_cursors" ADD CONSTRAINT "mailbox_sync_cursors_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_labels" ADD CONSTRAINT "gmail_labels_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_conversations" ADD CONSTRAINT "mailbox_conversations_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_message_links" ADD CONSTRAINT "gmail_message_links_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_message_links" ADD CONSTRAINT "gmail_message_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "gmail_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_label_operations" ADD CONSTRAINT "gmail_label_operations_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_label_operations" ADD CONSTRAINT "gmail_label_operations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_label_operations" ADD CONSTRAINT "gmail_label_operations_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "gmail_labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
