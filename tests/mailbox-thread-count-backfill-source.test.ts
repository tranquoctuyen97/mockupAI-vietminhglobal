import { readFileSync } from "node:fs";

describe("gmail thread count backfill script source", () => {
  const source = readFileSync("scripts/backfill-gmail-thread-counts.ts", "utf8");

  it("supports optional mailbox id plus dry-run and limit", () => {
    expect(source).toContain("--mailbox-id");
    expect(source).toContain("--dry-run");
    expect(source).toContain("--limit");
    expect(source).toContain("where: mailboxId ? { id: mailboxId, isActive: true } : { isActive: true }");
    expect(source).toContain("mailboxes.length === 0");
    expect(source).not.toContain("mailboxId required");
  });

  it("counts Gmail All Mail thread messages and only updates changed counts", () => {
    expect(source).toContain("fetchThreadMessages(conversation.gmailThreadId)");
    expect(source).toContain("messageCount !== conversation.articleCount");
    expect(source).toContain("articleCount: messageCount");
    expect(source).toContain("dryRun");
  });

  it("continues after per-thread failures and prints a summary", () => {
    expect(source).toContain("failed += 1");
    expect(source).toContain("continue");
    expect(source).toContain("checked=");
    expect(source).toContain("updated=");
    expect(source).toContain("unchanged=");
  });

  it("runs active mailboxes sequentially when no mailbox id is provided", () => {
    expect(source).toContain("for (const mailbox of mailboxes)");
    expect(source).toContain("await backfillMailbox");
    expect(source).toContain("mailboxId=${mailbox.id}");
  });
});
