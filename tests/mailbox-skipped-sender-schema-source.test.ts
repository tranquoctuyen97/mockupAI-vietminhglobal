import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox skipped sender schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260628165000_mailbox_skipped_senders/migration.sql",
    "utf8",
  );

  it("adds a mailbox-scoped skipped sender model", () => {
    expect(schema).toContain("model MailboxSkippedSender");
    expect(schema).toContain("skippedSenders MailboxSkippedSender[]");
    expect(schema).toContain("@@unique([mailboxId, senderEmail])");
    expect(schema).toContain('@@map("mailbox_skipped_senders")');
  });

  it("creates the DB table and unique mailbox sender constraint", () => {
    expect(migration).toContain('CREATE TABLE "mailbox_skipped_senders"');
    expect(migration).toContain('"mailbox_id" TEXT NOT NULL');
    expect(migration).toContain('"sender_email" TEXT NOT NULL');
    expect(migration).toContain('"created_by_id" TEXT NOT NULL');
    expect(migration).toContain('"mailbox_skipped_senders_mailbox_id_sender_email_key"');
  });
});
