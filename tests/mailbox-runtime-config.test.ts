import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  removeRuntimeMailboxConfigs,
  renderGetmailConfig,
  renderMsmtpConfig,
} from "../src/lib/mailboxes/runtime-config";

describe("mailbox runtime configuration", () => {
  const input = { mailboxId: "mailbox_1", email: "support@example.test", appPassword: "never-print-me" };

  it("renders bounded bootstrap Inbox sync without credentials", () => {
    const rendered = renderGetmailConfig({ ...input, initialSyncAfter: new Date("2025-12-24T00:00:00Z"), lastCommittedUid: BigInt(0) });
    expect(rendered).not.toContain(input.appPassword);
    expect(rendered).toContain('mailboxes = ("INBOX",)');
    expect(rendered).toContain("use_peek = true");
    expect(rendered).toContain("delete = false");
    expect(rendered).toContain("allow_root_commands = true");
    expect(rendered).toContain("imap_search = (SINCE 24-Dec-2025)");
    expect(rendered).toContain(join(process.cwd(), "node_modules/.bin/tsx"));
    expect(rendered).toContain(join(process.cwd(), "scripts/mailbox-secret-helper.ts"));
    expect(rendered).toContain(join(process.cwd(), "scripts/verified-rt-mailgate.ts"));
  });

  it("renders a computed steady-state UID range", () => {
    expect(renderGetmailConfig({ ...input, initialSyncAfter: new Date(), lastCommittedUid: BigInt(100) })).toContain("imap_search = (UID 101:*)");
  });

  it("uses passwordeval for Gmail SMTP", () => {
    const rendered = renderMsmtpConfig(input);
    expect(rendered).not.toContain(input.appPassword);
    expect(rendered).toContain("passwordeval");
    expect(rendered).toContain("smtp.gmail.com");
  });

  it("removes both runtime configs when a mailbox is disabled", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "mailbox-runtime-"));
    const configDir = join(runtimeDir, "configs");
    await mkdir(configDir, { recursive: true });
    await Promise.all([
      writeFile(join(configDir, "mailbox_1.getmailrc"), "test"),
      writeFile(join(configDir, "mailbox_1.msmtprc"), "test"),
    ]);

    await removeRuntimeMailboxConfigs("mailbox_1", runtimeDir);

    await expect(readFile(join(configDir, "mailbox_1.getmailrc"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(configDir, "mailbox_1.msmtprc"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
