import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertSafeMailboxId } from "./credentials";

interface RuntimeInput {
  mailboxId: string;
  email: string;
  appPassword?: string;
}

interface GetmailInput extends RuntimeInput {
  initialSyncAfter: Date;
  lastCommittedUid: bigint;
}

const MAILBOX_SCRIPT_ROOT = process.env.MAILBOX_SCRIPT_ROOT ?? process.cwd();

function assertRuntimeInput(input: RuntimeInput): void {
  assertSafeMailboxId(input.mailboxId);
  if (!/^[^\s@]+@[^\s@]+$/.test(input.email) || /[\r\n"]/.test(input.email)) throw new Error("invalid_mailbox_email");
}

function imapDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("invalid_sync_date");
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(value)
    .replace(/ /g, "-");
}

export function renderGetmailConfig(input: GetmailInput): string {
  assertRuntimeInput(input);
  const search = input.lastCommittedUid > BigInt(0)
    ? `UID ${input.lastCommittedUid + BigInt(1)}:*`
    : `SINCE ${imapDate(input.initialSyncAfter)}`;
  const mailboxSecretHelper = join(MAILBOX_SCRIPT_ROOT, "scripts/mailbox-secret-helper.ts");
  const verifiedMailgate = join(MAILBOX_SCRIPT_ROOT, "scripts/verified-rt-mailgate.ts");
  return `[retriever]
type = SimpleIMAPSSLRetriever
server = imap.gmail.com
username = ${input.email}
password_command = ("${join(MAILBOX_SCRIPT_ROOT, "node_modules/.bin/tsx")}", "${mailboxSecretHelper}", "${input.mailboxId}")
mailboxes = ("INBOX",)
use_peek = true
imap_search = (${search})

[destination]
type = MDA_external
path = ${join(MAILBOX_SCRIPT_ROOT, "node_modules/.bin/tsx")}
arguments = ("${verifiedMailgate}", "--mailbox-id", "${input.mailboxId}")
allow_root_commands = true

[options]
delete = false
read_all = true
verbose = 0
`;
}

export function renderMsmtpConfig(input: RuntimeInput): string {
  assertRuntimeInput(input);
  return `defaults
auth on
tls on
tls_starttls on

account gmail
host smtp.gmail.com
port 587
from ${input.email}
user ${input.email}
passwordeval /usr/local/bin/mailbox-secret-helper ${input.mailboxId}

account default : gmail
`;
}

export async function writeRuntimeMailboxConfig(input: GetmailInput, runtimeDir: string): Promise<{
  getmailConfigPath: string;
  msmtpConfigPath: string;
}> {
  assertRuntimeInput(input);
  const configDir = join(runtimeDir, "configs");
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  const getmailConfigPath = join(configDir, `${input.mailboxId}.getmailrc`);
  const msmtpConfigPath = join(configDir, `${input.mailboxId}.msmtprc`);
  await atomicWrite(getmailConfigPath, renderGetmailConfig(input));
  await atomicWrite(msmtpConfigPath, renderMsmtpConfig(input));
  return { getmailConfigPath, msmtpConfigPath };
}

export async function removeRuntimeMailboxConfigs(
  mailboxId: string,
  runtimeDir: string,
): Promise<void> {
  assertSafeMailboxId(mailboxId);
  await Promise.all([
    rm(join(runtimeDir, "configs", `${mailboxId}.getmailrc`), { force: true }),
    rm(join(runtimeDir, "configs", `${mailboxId}.msmtprc`), { force: true }),
  ]);
}

async function atomicWrite(destination: string, content: string): Promise<void> {
  const temporary = `${destination}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
