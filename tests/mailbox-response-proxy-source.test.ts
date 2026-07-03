import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function functionBody(source: string, name: string) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("mailbox response proxy hooks", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

  it("updates response metrics only after outbound Gmail link persistence", () => {
    const body = functionBody(source, "handleReply");

    expect(body).toContain("mailboxResponseMetrics.recordAdminReply");
    expect(body.indexOf("await prisma.gmailMessageLink.create")).toBeLessThan(
      body.indexOf("mailboxResponseMetrics.recordAdminReply"),
    );
    expect(body).toContain("actorUserId");
    expect(body).toContain("const repliedAt = sent.internalDate");
    expect(body).toContain("repliedAt,");
  });

  it("exposes summary and overdue response metric proxy routes", () => {
    expect(source).toContain('proxyPath === "/response-metrics/summary"');
    expect(source).toContain('proxyPath === "/response-metrics/overdue"');
    expect(source).toContain("handleResponseMetricSummary");
    expect(source).toContain("handleOverdueResponseMetrics");
    expect(source).toContain("serializeOverdueResponseMetric");
    expect(source).toContain("dateRange(request.nextUrl.searchParams)");
    expect(source).toContain("parseRangeBoundary");
    expect(source).toContain("value.includes(\"T\")");
    expect(source).toContain("buildResponseSummary");
  });

  it("keeps overdue count scoped to active Inbox conversations", () => {
    const service = readFileSync("src/lib/mailboxes/response-metrics.ts", "utf8");

    expect(service).toContain('status: "active"');
    expect(service).toContain('type: "INBOX"');
  });
});
