import { ImapFlow } from "imapflow";
import type { FetchMessageObject, FetchQueryObject, ImapFlowOptions, ListResponse, SearchObject } from "imapflow";
import type { GmailCredentials, GmailLabelDescriptor, GmailMessageMetadata, GmailScanResult } from "./types";

type GmailImapClient = Pick<
  ImapFlow,
  | "capabilities"
  | "mailbox"
  | "connect"
  | "logout"
  | "on"
  | "status"
  | "getMailboxLock"
  | "search"
  | "fetchAll"
  | "fetchOne"
  | "list"
  | "mailboxCreate"
  | "mailboxRename"
  | "mailboxDelete"
  | "messageFlagsAdd"
  | "messageFlagsRemove"
> & {
  authenticated: ImapFlow["authenticated"];
  usable: ImapFlow["usable"];
};

export type GmailImapFactory = (options: ImapFlowOptions) => GmailImapClient;

const DEFAULT_ALL_MAIL = "[Gmail]/All Mail";
const PROTECTED_NAMES = new Set(["inbox", "important", "starred"]);
const HIDDEN_SPECIAL_USES = new Set(["\\All", "\\Junk", "\\Trash", "\\Drafts", "\\Archive"]);
const FETCH_METADATA: FetchQueryObject = {
  uid: true,
  flags: true,
  labels: true,
  threadId: true,
  envelope: true,
  headers: ["message-id"],
  internalDate: true,
};
const FETCH_THREAD_MESSAGE: FetchQueryObject = {
  ...FETCH_METADATA,
  source: true,
};
const GMAIL_CONNECTION_TIMEOUT_MS = 30_000;
const GMAIL_SOCKET_TIMEOUT_MS = 120_000;

function headerSearch(field: string, value: string): SearchObject {
  return { header: [field, value] } as unknown as SearchObject;
}

function gmailRawSearch(value: string): SearchObject {
  return { gmailRaw: value } as unknown as SearchObject;
}

function normalizeLabelName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function isInboxLabel(name: string): boolean {
  const normalized = normalizeLabelName(name);
  return normalized === "inbox" || normalized === "\\inbox";
}

function isSpamLabel(name: string): boolean {
  const normalized = normalizeLabelName(name);
  return normalized === "spam" || normalized === "\\spam" || normalized === "[gmail]/spam";
}

function assertMutableLabel(name: string): void {
  if (!name.trim() || name.startsWith("\\") || PROTECTED_NAMES.has(normalizeLabelName(name))) {
    throw new Error("gmail_system_label_read_only");
  }
}

function parseMessageId(headers?: Buffer): string | null {
  if (!headers) return null;
  return headers.toString("utf8").match(/^message-id:\s*(.+?)\s*$/im)?.[1] ?? null;
}

function parseSourceMessageId(source?: Buffer): string | null {
  if (!source) return null;
  return headerValue(splitMessage(source.toString("utf8")).headerText, "message-id");
}

function splitMessage(raw: string): { headerText: string; body: string } {
  const separator = raw.match(/\r?\n\r?\n/);
  if (!separator) return { headerText: "", body: raw };
  return {
    headerText: raw.slice(0, separator.index),
    body: raw.slice((separator.index ?? 0) + separator[0].length),
  };
}

function headerValue(headerText: string, name: string): string | null {
  return headerText.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im"))?.[1] ?? null;
}

function contentTypeFrom(headerText: string): string {
  return headerValue(headerText, "content-type")?.split(";")[0]?.trim().toLowerCase() || "text/plain";
}

function charsetFrom(headerText: string): BufferEncoding {
  const charset = headerValue(headerText, "content-type")?.match(/charset="?([^";]+)"?/i)?.[1]?.toLowerCase();
  if (charset === "iso-8859-1" || charset === "latin1" || charset === "windows-1252") return "latin1";
  return "utf8";
}

function contentTransferEncodingFrom(headerText: string): string {
  return headerValue(headerText, "content-transfer-encoding")?.trim().toLowerCase() || "7bit";
}

function boundaryFrom(headerText: string): string | null {
  return headerValue(headerText, "content-type")?.match(/boundary="?([^";]+)"?/i)?.[1] ?? null;
}

function decodeQuotedPrintable(input: string, charset: BufferEncoding): string {
  const bytes: number[] = [];
  const normalized = input.replace(/=\r?\n/g, "");
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "=" && /^[0-9a-f]{2}$/i.test(normalized.slice(index + 1, index + 3))) {
      bytes.push(parseInt(normalized.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(normalized.charCodeAt(index));
    }
  }
  return Buffer.from(bytes).toString(charset);
}

function decodeMimeBody(body: string, encoding: string, charset: BufferEncoding): string {
  if (encoding === "base64") {
    return Buffer.from(body.replace(/\s/g, ""), "base64").toString(charset);
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body, charset);
  return body;
}

function parseMimePart(headerText: string, body: string, depth = 0): { body: string; contentType: string } {
  const contentType = contentTypeFrom(headerText);
  if (!contentType.startsWith("multipart/") || depth > 8) {
    return {
      body: decodeMimeBody(body, contentTransferEncodingFrom(headerText), charsetFrom(headerText)).trim(),
      contentType,
    };
  }

  const boundary = boundaryFrom(headerText);
  if (!boundary) return { body: body.trim(), contentType: "text/plain" };

  const parts = body
    .split(`--${boundary}`)
    .map((part) => part.replace(/^--\s*/, "").trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = splitMessage(part);
      return parseMimePart(parsed.headerText, parsed.body, depth + 1);
    });
  const readable = parts.find((part) => part.contentType === "text/html")
    ?? parts.find((part) => part.contentType === "text/plain");
  return {
    body: readable?.body.trim() ?? parts[0]?.body.trim() ?? body.trim(),
    contentType: readable?.contentType ?? parts[0]?.contentType ?? "text/plain",
  };
}

function parseBody(source?: Buffer): { body: string; contentType: string } {
  if (!source) return { body: "", contentType: "text/plain" };
  const raw = source.toString("utf8");
  const { headerText, body } = splitMessage(raw);
  return parseMimePart(headerText, body);
}

function toMetadata(message: FetchMessageObject, uidValidity: bigint): GmailMessageMetadata {
  if (!message.emailId || !message.threadId) throw new Error("gmail_metadata_incomplete");
  const sender = message.envelope?.from?.[0];
  const recipient = message.envelope?.to?.[0];
  const parsed = message.source ? parseBody(message.source) : null;
  return {
    uid: BigInt(message.uid),
    uidValidity,
    gmailMessageId: message.emailId,
    gmailThreadId: message.threadId,
    rfcMessageId: parseMessageId(message.headers),
    internalDate: new Date(message.internalDate ?? 0),
    subject: message.envelope?.subject || undefined,
    fromEmail: sender?.address || undefined,
    fromName: sender?.name || undefined,
    toEmail: recipient?.address || undefined,
    toName: recipient?.name || undefined,
    flags: [...(message.flags ?? [])],
    labels: [...(message.labels ?? [])],
    ...(parsed ? { body: parsed.body, contentType: parsed.contentType } : {}),
  };
}

function compactMetadata(messages: FetchMessageObject[], uidValidity: bigint): GmailMessageMetadata[] {
  const result: GmailMessageMetadata[] = [];
  for (const message of messages) {
    try {
      result.push(toMetadata(message, uidValidity));
    } catch (error) {
      if (error instanceof Error && error.message === "gmail_metadata_incomplete") {
        console.warn(`[Gmail] Skipping message with incomplete metadata uid=${message.uid ?? "unknown"}`);
        continue;
      }
      throw error;
    }
  }
  return result;
}

function systemDescriptor(mailbox: Pick<ListResponse, "path" | "specialUse">): GmailLabelDescriptor | null {
  const lowerPath = mailbox.path.toLocaleLowerCase("en-US");
  if (mailbox.specialUse === "\\Inbox" || lowerPath === "inbox") return { name: "INBOX", normalizedName: "inbox", type: "INBOX", mutable: false };
  if (mailbox.specialUse === "\\Sent" || lowerPath.endsWith("/sent") || lowerPath === "sent") return { name: "SENT", normalizedName: "sent", type: "SENT", mutable: false };
  if (mailbox.specialUse === "\\Important" || lowerPath.endsWith("/important")) return { name: "IMPORTANT", normalizedName: "important", type: "IMPORTANT", mutable: false };
  if (mailbox.specialUse === "\\Flagged" || lowerPath.endsWith("/starred")) return { name: "STARRED", normalizedName: "starred", type: "STARRED", mutable: false };
  return null;
}

export function createGmailAdapter(
  credentials: GmailCredentials,
  createClient: GmailImapFactory = (options) => new ImapFlow(options),
) {
  function client(): GmailImapClient {
    return createClient({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: credentials.email, pass: credentials.appPassword },
      logger: false,
      connectionTimeout: GMAIL_CONNECTION_TIMEOUT_MS,
      greetingTimeout: GMAIL_CONNECTION_TIMEOUT_MS,
      socketTimeout: GMAIL_SOCKET_TIMEOUT_MS,
    });
  }

  async function withClient<T>(operation: (connection: GmailImapClient) => Promise<T>): Promise<T> {
    const connection = client();
    connection.on("error", () => undefined);
    try {
      await connection.connect();
      if (!connection.capabilities.has("X-GM-EXT-1")) throw new Error("gmail_extension_missing");
      return await operation(connection);
    } finally {
      if (connection.usable || connection.authenticated) {
        try { await connection.logout(); } catch { /* connection may already be closed */ }
      }
    }
  }

  async function fetchLocked(
    connection: GmailImapClient,
    mailboxName: string,
    range: string | number[],
  ): Promise<GmailScanResult> {
    const lock = await connection.getMailboxLock(mailboxName);
    try {
      const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
      if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
      const fetched = await connection.fetchAll(range, FETCH_THREAD_MESSAGE, { uid: true });
      return {
        uidValidity,
        messages: compactMetadata(fetched, uidValidity).sort((a, b) => Number(a.uid - b.uid)),
      };
    } finally {
      lock.release();
    }
  }

  async function mutateLabel(uids: number[], label: string, add: boolean): Promise<void> {
    assertMutableLabel(label);
    await withClient(async (connection) => {
      const lock = await connection.getMailboxLock("INBOX");
      try {
        const method = add ? connection.messageFlagsAdd.bind(connection) : connection.messageFlagsRemove.bind(connection);
        await method(uids, [label], { uid: true, useLabels: true });
        for (const uid of uids) {
          const readback = await connection.fetchOne(String(uid), { flags: true, labels: true }, { uid: true });
          if (!readback || readback.flags?.has("\\Seen") || Boolean(readback.labels?.has(label)) !== add) {
            throw new Error("gmail_readback_mismatch");
          }
        }
      } finally {
        lock.release();
      }
    });
  }

  async function updateSeenState(
    connection: GmailImapClient,
    mailboxName: string,
    uids: number[],
    seen: boolean,
  ): Promise<void> {
    if (uids.length === 0) return;
    const lock = await connection.getMailboxLock(mailboxName);
    try {
      if (seen) {
        await connection.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      } else {
        await connection.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
      }
      for (const uid of uids) {
        const readback = await connection.fetchOne(String(uid), { flags: true }, { uid: true });
        const isSeen = readback !== false && Boolean(readback.flags?.has("\\Seen"));
        if (!readback || isSeen !== seen) {
          throw new Error("gmail_seen_readback_mismatch");
        }
      }
    } finally {
      lock.release();
    }
  }

  return {
    probe: () => withClient(async () => ({ ok: true as const })),

    fetchInboxByUids: (uids: bigint[]) => withClient(async (connection) => {
      if (uids.length === 0) {
        const lock = await connection.getMailboxLock("INBOX");
        try {
          const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
          if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
          return { uidValidity, messages: [] };
        } finally {
          lock.release();
        }
      }
      return fetchLocked(connection, "INBOX", uids.map((uid) => Number(uid)));
    }),

    scanInbox: (input: { initialSyncAfter: Date; lastCommittedUid: bigint }) => withClient(async (connection) => {
      const lock = await connection.getMailboxLock("INBOX");
      try {
        const uids = await connection.search({ since: input.initialSyncAfter }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return { uidValidity, messages: [] };
        const messages = await connection.fetchAll(uids, FETCH_THREAD_MESSAGE, { uid: true });
        return { uidValidity, messages: compactMetadata(messages, uidValidity).sort((a, b) => Number(a.uid - b.uid)) };
      } finally {
        lock.release();
      }
    }),

    scanSent: (input: { initialSyncAfter: Date }) => withClient(async (connection) => {
      const sentPath = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\Sent")?.path ?? "[Gmail]/Sent Mail";
      const lock = await connection.getMailboxLock(sentPath);
      try {
        const uids = await connection.search({ since: input.initialSyncAfter }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return { uidValidity, messages: [] };
        const messages = await connection.fetchAll(uids, FETCH_THREAD_MESSAGE, { uid: true });
        return {
          uidValidity,
          messages: compactMetadata(messages, uidValidity)
            .map((message) => ({ ...message, labels: [...new Set([...message.labels, "sent"])] }))
            .sort((a, b) => Number(a.uid - b.uid)),
        };
      } finally {
        lock.release();
      }
    }),

    listVisibleLabels: () => withClient(async (connection) => {
      const mailboxes = await connection.list();
      const system = new Map<string, GmailLabelDescriptor>();
      const user: GmailLabelDescriptor[] = [];
      for (const mailbox of mailboxes) {
        const descriptor = systemDescriptor(mailbox);
        if (descriptor) {
          system.set(descriptor.type, descriptor);
        } else if (
          !mailbox.specialUse
          && mailbox.path !== "[Gmail]"
          && !mailbox.path.startsWith("[Gmail]/")
        ) {
          user.push({ name: mailbox.path, normalizedName: normalizeLabelName(mailbox.path), type: "USER", mutable: true });
        } else if (!HIDDEN_SPECIAL_USES.has(mailbox.specialUse ?? "")) {
          continue;
        }
      }
      return (["INBOX", "SENT", "IMPORTANT", "STARRED"] as const)
        .map((type) => system.get(type))
        .filter((label): label is GmailLabelDescriptor => Boolean(label))
        .concat(user.sort((a, b) => a.name.localeCompare(b.name)));
    }),

    createLabel: (name: string) => { assertMutableLabel(name); return withClient(async (connection) => connection.mailboxCreate(name)); },
    renameLabel: (oldName: string, newName: string) => { assertMutableLabel(oldName); assertMutableLabel(newName); return withClient(async (connection) => connection.mailboxRename(oldName, newName)); },
    deleteLabel: (name: string) => { assertMutableLabel(name); return withClient(async (connection) => connection.mailboxDelete(name)); },
    assignLabel: (uids: number[], label: string) => mutateLabel(uids, label, true),
    unassignLabel: (uids: number[], label: string) => mutateLabel(uids, label, false),
    markThreadRead: (gmailThreadId: string) => withClient(async (connection) => {
      if (!gmailThreadId) throw new Error("gmail_thread_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      let unreadThreadUids: number[] = [];
      try {
        const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return;
        const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        unreadThreadUids = fetched
          .filter((message) => ![...(message.flags ?? [])].includes("\\Seen"))
          .map((message) => Number(message.uid));
      } finally {
        lock.release();
      }
      await updateSeenState(connection, allMail, unreadThreadUids, true);
    }),

    markThreadUnread: (gmailThreadId: string) => withClient(async (connection) => {
      if (!gmailThreadId) throw new Error("gmail_thread_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      let seenThreadUids: number[] = [];
      try {
        const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return;
        const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        seenThreadUids = fetched
          .filter((message) => [...(message.flags ?? [])].includes("\\Seen"))
          .map((message) => Number(message.uid));
      } finally {
        lock.release();
      }
      await updateSeenState(connection, allMail, seenThreadUids, false);
    }),

    reportThreadSpam: (gmailThreadId: string) => withClient(async (connection) => {
      if (!gmailThreadId) throw new Error("gmail_thread_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      try {
        const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
        if (!uids || uids.length === 0) return;
        const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        const threadUids = fetched.map((message) => Number(message.uid));
        const inboxUids = fetched
          .filter((message) => [...(message.labels ?? [])].some((label) => isInboxLabel(label)))
          .map((message) => Number(message.uid));

        if (threadUids.length > 0) {
          await connection.messageFlagsAdd(threadUids, ["\\Spam"], { uid: true, useLabels: true });
        }
        if (inboxUids.length > 0) {
          await connection.messageFlagsRemove(inboxUids, ["\\Inbox"], { uid: true, useLabels: true });
        }
      } finally {
        lock.release();
      }
    }),

    moveInboxMessagesToSpam: (uids: number[]) => withClient(async (connection) => {
      const deduped = [...new Set(uids.filter((uid) => Number.isInteger(uid) && uid > 0))];
      if (deduped.length === 0) return;
      const lock = await connection.getMailboxLock("INBOX");
      try {
        await connection.messageFlagsAdd(deduped, ["\\Spam"], { uid: true, useLabels: true });
        await connection.messageFlagsRemove(deduped, ["\\Inbox"], { uid: true, useLabels: true });
      } finally {
        lock.release();
      }
    }),

    moveThreadToTrash: (gmailThreadId: string) => withClient(async (connection) => {
      if (!gmailThreadId) throw new Error("gmail_thread_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      try {
        const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
        if (!uids || uids.length === 0) return;
        const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        const threadUids = fetched.map((message) => Number(message.uid));
        const inboxUids = fetched
          .filter((message) => [...(message.labels ?? [])].some((label) => isInboxLabel(label)))
          .map((message) => Number(message.uid));
        const spamUids = fetched
          .filter((message) => [...(message.labels ?? [])].some((label) => isSpamLabel(label)))
          .map((message) => Number(message.uid));

        if (threadUids.length > 0) {
          await connection.messageFlagsAdd(threadUids, ["\\Trash"], { uid: true, useLabels: true });
        }
        if (inboxUids.length > 0) {
          await connection.messageFlagsRemove(inboxUids, ["\\Inbox"], { uid: true, useLabels: true });
        }
        if (spamUids.length > 0) {
          await connection.messageFlagsRemove(spamUids, ["\\Spam"], { uid: true, useLabels: true });
        }
      } finally {
        lock.release();
      }
    }),

    lookupKnownThread: (gmailThreadId: string) => withClient(async (connection) => {
      if (!gmailThreadId) throw new Error("gmail_thread_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      try {
        const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return { uidValidity, messages: [] };
        const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        const messages = compactMetadata(fetched, uidValidity);
        if (messages.some((message) => message.gmailThreadId !== gmailThreadId)) throw new Error("gmail_thread_mismatch");
        return { uidValidity, messages };
      } finally {
        lock.release();
      }
    }),

    lookupKnownThreads: (gmailThreadIds: string[]) => withClient(async (connection) => {
      const dedupedThreadIds = [...new Set(gmailThreadIds.filter(Boolean))];
      if (dedupedThreadIds.length === 0) return new Map<string, GmailScanResult>();
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      try {
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");

        const results = new Map<string, GmailScanResult>();
        for (const gmailThreadId of dedupedThreadIds) {
          const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
          if (!uids || uids.length === 0) {
            results.set(gmailThreadId, { uidValidity, messages: [] });
            continue;
          }
          const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
          const messages = compactMetadata(fetched, uidValidity);
          if (messages.some((message) => message.gmailThreadId !== gmailThreadId)) {
            throw new Error("gmail_thread_mismatch");
          }
          results.set(gmailThreadId, { uidValidity, messages });
        }
        return results;
      } finally {
        lock.release();
      }
    }),

    fetchThreadMessages: (gmailThreadId: string) => withClient(async (connection) => {
      if (!gmailThreadId) throw new Error("gmail_thread_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      try {
        const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return { uidValidity, messages: [] };
        const fetched = await connection.fetchAll(uids, FETCH_THREAD_MESSAGE, { uid: true });
        const messages = fetched.map((message) => {
          if (!message.emailId || !message.threadId) throw new Error("gmail_metadata_incomplete");
          if (message.threadId !== gmailThreadId) throw new Error("gmail_thread_mismatch");
          const sender = message.envelope?.from?.[0];
          const recipient = message.envelope?.to?.[0];
          const parsed = parseBody(message.source);
          return {
            uid: BigInt(message.uid),
            uidValidity,
            gmailMessageId: message.emailId,
            gmailThreadId: message.threadId,
            rfcMessageId: parseMessageId(message.headers) ?? parseSourceMessageId(message.source),
            internalDate: new Date(message.internalDate ?? 0),
            subject: message.envelope?.subject || undefined,
            fromEmail: sender?.address || undefined,
            fromName: sender?.name || undefined,
            toEmail: recipient?.address || undefined,
            toName: recipient?.name || undefined,
            flags: [...(message.flags ?? [])],
            labels: [...(message.labels ?? [])],
            body: parsed.body,
            contentType: parsed.contentType,
          };
        });
        return { uidValidity, messages: messages.sort((a, b) => Number(a.uid - b.uid)) };
      } finally {
        lock.release();
      }
    }),

    lookupByMessageId: (rfcMessageId: string) => withClient(async (connection) => {
      const messageId = rfcMessageId.trim().replace(/^<|>$/g, "");
      if (!messageId || /[\r\n]/.test(messageId)) throw new Error("gmail_message_id_required");
      const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
      const lock = await connection.getMailboxLock(allMail);
      try {
        const uids = await connection.search(gmailRawSearch(`rfc822msgid:${messageId}`), { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return null;
        if (uids.length > 1) throw new Error("gmail_message_id_not_unique");
        const fetched = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        if (fetched.length !== 1) return null;
        return compactMetadata(fetched, uidValidity)[0] ?? null;
      } finally {
        lock.release();
      }
    }),
  };
}
