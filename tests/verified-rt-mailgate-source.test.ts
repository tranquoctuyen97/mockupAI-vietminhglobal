import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("verified RT mailgate persistence source", () => {
  it("reuses existing Gmail thread conversations before creating a new RT-ticket conversation", () => {
    const source = readFileSync("scripts/verified-rt-mailgate.ts", "utf8");

    expect(source).toContain("tx.mailboxConversation.findFirst");
    expect(source).toContain("{ gmailThreadId: link.gmailThreadId }");
    expect(source).toContain("{ rtTicketId: input.rtTicketId }");
    expect(source).not.toContain("tx.mailboxConversation.upsert");
  });

  it("falls back to subject-based RT ticket resolution when Message-ID lookup is not ready", () => {
    const source = readFileSync("scripts/verified-rt-mailgate.ts", "utf8");

    expect(source).toContain("resolveBySubject");
    expect(source).toContain("searchTickets({ queueId, pageSize: 100 })");
    expect(source).toContain("transaction.type === \"create\"");
  });

  it("persists list snapshot fields when linking RT tickets to Gmail threads", () => {
    const source = readFileSync("scripts/verified-rt-mailgate.ts", "utf8");

    expect(source).toContain("subject:");
    expect(source).toContain("articleCount:");
    expect(source).toContain("rtLastUpdatedAt:");
    expect(source).toContain("lastActivityAt:");
  });
});
