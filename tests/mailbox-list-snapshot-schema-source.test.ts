import { readFileSync } from "node:fs";

describe("mailbox conversation list snapshot schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260628130000_mailbox_conversation_list_snapshot/migration.sql",
    "utf8",
  );

  it("adds list snapshot fields to MailboxConversation", () => {
    expect(schema).toMatch(/subject\s+String\?\s+@map\("subject"\)/);
    expect(schema).toMatch(/articleCount\s+Int\s+@default\(0\)\s+@map\("article_count"\)/);
    expect(schema).toMatch(/rtStatus\s+String\?\s+@map\("rt_status"\)/);
    expect(schema).toMatch(/rtCreatedAt\s+DateTime\?\s+@map\("rt_created_at"\)/);
    expect(schema).toMatch(/rtLastUpdatedAt\s+DateTime\?\s+@map\("rt_last_updated_at"\)/);
  });

  it("creates snapshot columns and list indexes", () => {
    expect(migration).toContain('ADD COLUMN "subject" TEXT');
    expect(migration).toContain('ADD COLUMN "article_count" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN "rt_status" TEXT');
    expect(migration).toContain('ADD COLUMN "rt_created_at" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "rt_last_updated_at" TIMESTAMP(3)');
    expect(migration).toContain('CREATE INDEX "mailbox_conversations_mailbox_id_rt_last_updated_at_idx"');
  });
});
