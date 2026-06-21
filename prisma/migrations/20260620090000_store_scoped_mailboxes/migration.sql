-- Add nullable ownership columns first so existing mailbox rows can be mapped
-- to stores before a follow-up migration enforces NOT NULL.
ALTER TABLE "mailboxes" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "mailboxes" ADD COLUMN "store_id" TEXT;

CREATE INDEX "mailboxes_tenant_id_store_id_is_active_idx" ON "mailboxes"("tenant_id", "store_id", "is_active");
CREATE INDEX "mailboxes_store_id_idx" ON "mailboxes"("store_id");

ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
