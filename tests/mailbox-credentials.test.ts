import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getDecryptedAppPassword,
  materializeRuntimeSecret,
  saveEncryptedAppPassword,
} from "../src/lib/mailboxes/credentials";
import { runSecretHelper } from "../scripts/mailbox-secret-helper";

describe("mailbox credential handling", () => {
  it("encrypts at rest and writes runtime secrets with mode 0600", async () => {
    vi.stubEnv("MASTER_ENCRYPTION_KEY", "11".repeat(32));
    vi.stubEnv("MASTER_ENCRYPTION_KEY_ID", "v1");
    let row: { appPasswordEncrypted: Uint8Array<ArrayBuffer>; encryptionKeyId: string } | null = null;
    const store = {
      update: vi.fn(async (_id: string, value: NonNullable<typeof row>) => { row = value; return value; }),
      find: vi.fn(async () => row),
    };
    await saveEncryptedAppPassword("mailbox_1", "gmail-app-password", store);
    expect(Buffer.from(row!.appPasswordEncrypted).toString()).not.toContain("gmail-app-password");
    expect(await getDecryptedAppPassword("mailbox_1", store)).toBe("gmail-app-password");

    const runtime = await mkdtemp(join(tmpdir(), "mailbox-runtime-"));
    const path = await materializeRuntimeSecret("mailbox_1", runtime, store);
    expect(await readFile(path, "utf8")).toBe("gmail-app-password\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects path traversal IDs", async () => {
    const store = { update: vi.fn(), find: vi.fn() };
    await expect(materializeRuntimeSecret("../escape", "/tmp/runtime", store)).rejects.toThrow("invalid_mailbox_id");
  });

  it("prints only the password on stdout", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    await expect(runSecretHelper(["mailbox_1"], { getPassword: async () => "secret", stdout, stderr })).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith("secret\n");
    expect(stderr).not.toHaveBeenCalled();
  });
});
