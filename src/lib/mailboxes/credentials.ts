import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";

export interface MailboxCredentialStore {
  update(mailboxId: string, value: { appPasswordEncrypted: Uint8Array<ArrayBuffer>; encryptionKeyId: string }): Promise<unknown>;
  find(mailboxId: string): Promise<{ appPasswordEncrypted: Uint8Array<ArrayBufferLike>; encryptionKeyId: string } | null>;
}

const prismaStore: MailboxCredentialStore = {
  update: (mailboxId, value) => prisma.mailbox.update({ where: { id: mailboxId }, data: value }),
  find: (mailboxId) => prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { appPasswordEncrypted: true, encryptionKeyId: true },
  }),
};

export function assertSafeMailboxId(mailboxId: string): void {
  if (!/^[a-z0-9_-]+$/i.test(mailboxId)) throw new Error("invalid_mailbox_id");
}

export async function saveEncryptedAppPassword(
  mailboxId: string,
  plaintext: string,
  store: MailboxCredentialStore = prismaStore,
): Promise<void> {
  assertSafeMailboxId(mailboxId);
  if (!plaintext) throw new Error("app_password_required");
  const value = encrypt(plaintext);
  await store.update(mailboxId, { appPasswordEncrypted: value.encrypted, encryptionKeyId: value.keyId });
}

export async function getDecryptedAppPassword(
  mailboxId: string,
  store: MailboxCredentialStore = prismaStore,
): Promise<string> {
  assertSafeMailboxId(mailboxId);
  const row = await store.find(mailboxId);
  if (!row) throw new Error("mailbox_not_found");
  return decrypt(row.appPasswordEncrypted);
}

export async function maskMailboxCredential(
  mailboxId: string,
  store: MailboxCredentialStore = prismaStore,
): Promise<string> {
  assertSafeMailboxId(mailboxId);
  if (!await store.find(mailboxId)) throw new Error("mailbox_not_found");
  return "••••••••••••••••";
}

export async function materializeRuntimeSecret(
  mailboxId: string,
  runtimeDir: string,
  store: MailboxCredentialStore = prismaStore,
): Promise<string> {
  assertSafeMailboxId(mailboxId);
  const password = await getDecryptedAppPassword(mailboxId, store);
  const secretsDir = join(runtimeDir, "secrets");
  const destination = join(secretsDir, mailboxId);
  const temporary = join(secretsDir, `.${mailboxId}.${Date.now()}.tmp`);
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${password}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
    return destination;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removeRuntimeSecret(mailboxId: string, runtimeDir: string): Promise<void> {
  assertSafeMailboxId(mailboxId);
  await rm(join(runtimeDir, "secrets", mailboxId), { force: true });
}
