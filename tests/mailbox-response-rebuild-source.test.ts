import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric rebuild script", () => {
  const script = readFileSync("scripts/rebuild-mailbox-response-metrics.ts", "utf8");
  const service = readFileSync("src/lib/mailboxes/response-metrics.ts", "utf8");

  it("supports dry-run by default and explicit write mode", () => {
    expect(script).toContain('import "dotenv/config"');
    expect(script).toContain("--write");
    expect(script).toContain("--limit=");
    expect(script).toContain("dryRun: !write");
    expect(script).toContain("mailboxResponseMetrics.rebuild");
    expect(script).toContain("prisma.$disconnect()");
  });

  it("derives start and latest reply from Gmail thread data when DB links lack outbound replies", () => {
    expect(service).toContain("createGmailAdapter");
    expect(service).toContain("getDecryptedAppPassword");
    expect(service).toContain("fetchThreadMessages(conversation.gmailThreadId)");
    expect(service).toContain("message.fromEmail?.trim().toLowerCase() === mailboxEmail");
    expect(service).toContain("message.fromEmail?.trim().toLowerCase() !== mailboxEmail");
    expect(service).toContain('direction: "INBOUND"');
    expect(service).toContain('direction: "OUTBOUND"');
    expect(service).toContain("gmailInternalDate");
    expect(service).toContain("responseStartedAt");
    expect(service).toContain("latestAdminReplyAt");
    expect(service).toContain("latestAdminReplyActorUserId");
    expect(service).toContain("replied += 1");
  });
});
