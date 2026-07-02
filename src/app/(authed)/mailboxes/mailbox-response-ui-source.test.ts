import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric UI", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");
  const navSource = readFileSync("src/app/(authed)/AuthedShell.tsx", "utf8");

  it("opens response metrics from the mailbox header instead of a sidebar route", () => {
    expect(navSource).not.toContain("/mailbox-response-metrics");
    expect(source).toContain("ResponseMetricsModal");
    expect(source).toContain("BarChart3");
    expect(source).toContain("Response metrics");
  });

  it("loads date-filtered response metrics through mailbox proxy", () => {
    expect(source).toContain("/api/mailbox-proxy/response-metrics/summary");
    expect(source).toContain("type=\"date\"");
    expect(source).toContain("Last 24 hours");
    expect(source).toContain("Last 30 days");
    expect(source).toContain("Avg response time");
    expect(source).toContain("only conversations with replies");
    expect(source).not.toContain("Export CSV");
    expect(source).not.toContain("distribution");
  });
});
