import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox sync metadata persistence source", () => {
  it("does not stop creating Gmail message links at the first message without an RT ticket", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("if (!link.rtTicketId || !link.rtTransactionId) continue;");
    expect(source).not.toContain("if (!link.rtTicketId || !link.rtTransactionId) break;");
  });

  it("allows long RT mailgate batches to finish before timing out getmail", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("MAILBOX_GETMAIL_TIMEOUT_MS");
    expect(source).toContain("600_000");
    expect(source).toContain("timeout: GETMAIL_TIMEOUT_MS");
  });

  it("allows new mailbox bootstrap batches to outlive Prisma's 5s transaction default", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS");
    expect(source).toContain("60_000");
    expect(source).toContain("timeout: MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS");
  });
});
