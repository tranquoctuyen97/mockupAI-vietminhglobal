import { readFileSync } from "node:fs";

describe("mailbox sync queue source", () => {
  const source = readFileSync("src/lib/mailboxes/queue.ts", "utf8");

  it("skips recently Gmail-rate-limited mailboxes", () => {
    expect(source).toContain("GMAIL_RATE_LIMIT_ERROR_CODE");
    expect(source).toContain("MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS");
    expect(source).toContain("lastSyncErrorCode: { not: GMAIL_RATE_LIMIT_ERROR_CODE }");
    expect(source).toContain("lastSyncErrorCode: null");
    expect(source).toContain("updatedAt: { lte: new Date(Date.now() - MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS) }");
  });
});
