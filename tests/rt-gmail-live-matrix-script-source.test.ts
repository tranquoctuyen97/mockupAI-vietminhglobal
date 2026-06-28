import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scriptPath = "scripts/verify-rt-gmail-live-matrix.ts";

describe("RT Gmail live matrix verifier source contract", () => {
  it("is exposed through stable npm scripts for operator handoff", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    expect(pkg.scripts["mailbox:matrix:preflight"]).toBe("tsx scripts/verify-rt-gmail-live-matrix.ts preflight");
    expect(pkg.scripts["mailbox:matrix:checklist"]).toBe("tsx scripts/verify-rt-gmail-live-matrix.ts checklist");
    expect(pkg.scripts["mailbox:matrix:template"]).toBe("tsx scripts/verify-rt-gmail-live-matrix.ts template");
  });

  it("exists and enumerates the complete disposable acceptance matrix", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = readFileSync(scriptPath, "utf8");

    for (const id of [
      "age-window",
      "excluded-mailboxes",
      "unread-preserved",
      "duplicate-poll",
      "label-crud",
      "cross-mailbox-isolation",
      "reply-inheritance",
      "closed-ticket-label-mutation",
      "gmail-sent-thread-reply",
      "body-attachment-readable",
    ]) {
      expect(source).toContain(`id: "${id}"`);
    }
  });

  it("enumerates resilience cases and provides credential-safe preflight output", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = readFileSync(scriptPath, "utf8");

    for (const id of [
      "rt-down",
      "gmail-imap-down",
      "gmail-smtp-down",
      "revoked-app-password",
      "worker-kill-before-gmail-mutation",
      "worker-kill-after-gmail-mutation",
      "mailgate-wrapper-kill-after-rt-accept",
      "duplicate-scheduler",
      "concurrent-label-and-sync",
      "uidvalidity-mismatch",
      "high-fanout-label-rename-delete",
    ]) {
      expect(source).toContain(`id: "${id}"`);
    }

    expect(source).toContain("LIVE_MATRIX_REQUIRED_ENV");
    expect(source).toContain("GMAIL_TEST_APP_PASSWORD");
    expect(source).toContain("redact");
    expect(source).not.toContain("process.env.GMAIL_TEST_APP_PASSWORD,");
    expect(source).not.toContain("process.env.RT_API_TOKEN,");
  });

  it("can create a credential-safe markdown evidence template for the live run", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = readFileSync(scriptPath, "utf8");

    expect(source).toContain("LIVE_MATRIX_TEMPLATE_PATH");
    expect(source).toContain("docs/reports/2026-06-24-rt-gmail-live-matrix.md");
    expect(source).toContain("writeTemplate");
    expect(source).toContain("sanitizeEvidence");
    expect(source).toContain("mkdirSync(dirname(outputPath)");
    expect(source).toContain("Generated: TODO live run timestamp");
    expect(source).not.toContain("new Date().toISOString()");
    expect(source).toContain("Do not paste Gmail App Passwords");
    expect(source).toContain("## Acceptance matrix");
    expect(source).toContain("## Resilience matrix");
    expect(source).toContain("command === \"template\"");
  });
});
