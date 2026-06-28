import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric rebuild script", () => {
  const script = readFileSync("scripts/rebuild-mailbox-response-metrics.ts", "utf8");
  const service = readFileSync("src/lib/mailboxes/response-metrics.ts", "utf8");

  it("supports dry-run by default and explicit write mode", () => {
    expect(script).toContain("--write");
    expect(script).toContain("dryRun: !write");
    expect(script).toContain("mailboxResponseMetrics.rebuild");
  });

  it("derives start and latest reply from inbound and outbound Gmail links", () => {
    expect(service).toContain('direction: "INBOUND"');
    expect(service).toContain('direction: "OUTBOUND"');
    expect(service).toContain("gmailInternalDate");
    expect(service).toContain("responseStartedAt");
    expect(service).toContain("latestAdminReplyAt");
    expect(service).toContain("latestAdminReplyActorUserId");
  });
});
