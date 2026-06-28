import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric UI", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("loads summary and overdue response metrics through mailbox proxy", () => {
    expect(source).toContain("/api/mailbox-proxy/response-metrics/summary");
    expect(source).toContain("/api/mailbox-proxy/response-metrics/overdue");
    expect(source).toContain("responseSummary");
    expect(source).toContain("overdueResponses");
  });

  it("renders operational response metric labels", () => {
    expect(source).toContain("Over 24h");
    expect(source).toContain("Avg response");
    expect(source).toContain("Oldest pending");
  });
});
