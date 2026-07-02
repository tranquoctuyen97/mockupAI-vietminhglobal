import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response proxy hooks", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

  it("updates response metrics only after outbound Gmail link persistence", () => {
    expect(source).toContain("mailboxResponseMetrics.recordAdminReply");
    expect(source.indexOf("await prisma.gmailMessageLink.create")).toBeLessThan(
      source.indexOf("mailboxResponseMetrics.recordAdminReply"),
    );
    expect(source).toContain("actorUserId");
    expect(source).toContain("const repliedAt = sent.internalDate");
    expect(source).toContain("repliedAt,");
  });

  it("exposes summary and overdue response metric proxy routes", () => {
    expect(source).toContain('proxyPath === "/response-metrics/summary"');
    expect(source).toContain('proxyPath === "/response-metrics/overdue"');
    expect(source).toContain("handleResponseMetricSummary");
    expect(source).toContain("handleOverdueResponseMetrics");
    expect(source).toContain("serializeOverdueResponseMetric");
  });

  it("keeps overdue count scoped to active Inbox conversations", () => {
    const service = readFileSync("src/lib/mailboxes/response-metrics.ts", "utf8");

    expect(service).toContain('status: "active"');
    expect(service).toContain('type: "INBOX"');
  });
});
