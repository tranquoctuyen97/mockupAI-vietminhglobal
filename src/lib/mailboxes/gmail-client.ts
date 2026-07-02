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
const HIDDEN_SPECIAL_USES = new Set(["\\All", "\\Junk", "\\Trash", "\\Sent", "\\Drafts", "\\Archive"]);
const FETCH_METADATA: FetchQueryObject = {
  uid: true,
  flags: true,
  labels: true,
  threadId: true,
  envelope: true,
  headers: ["message-id"],
  internalDate: true,
};

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

function toMetadata(message: FetchMessageObject, uidValidity: bigint): GmailMessageMetadata {
  if (!message.emailId || !message.threadId) throw new Error("gmail_metadata_incomplete");
  const sender = message.envelope?.from?.[0];
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
    flags: [...(message.flags ?? [])],
    labels: [...(message.labels ?? [])],
  };
}

function systemDescriptor(mailbox: Pick<ListResponse, "path" | "specialUse">): GmailLabelDescriptor | null {
  const lowerPath = mailbox.path.toLocaleLowerCase("en-US");
  if (mailbox.specialUse === "\\Inbox" || lowerPath === "inbox") return { name: "INBOX", normalizedName: "inbox", type: "INBOX", mutable: false };
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
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
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
      const fetched = await connection.fetchAll(range, FETCH_METADATA, { uid: true });
      return {
        uidValidity,
        messages: fetched.map((message) => toMetadata(message, uidValidity)).sort((a, b) => Number(a.uid - b.uid)),
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
      if (input.lastCommittedUid > BigInt(0)) {
        return fetchLocked(connection, "INBOX", `${input.lastCommittedUid + BigInt(1)}:*`);
      }
      const lock = await connection.getMailboxLock("INBOX");
      try {
        const uids = await connection.search({ since: input.initialSyncAfter }, { uid: true });
        const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
        if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
        if (!uids || uids.length === 0) return { uidValidity, messages: [] };
        const messages = await connection.fetchAll(uids, FETCH_METADATA, { uid: true });
        return { uidValidity, messages: messages.map((message) => toMetadata(message, uidValidity)).sort((a, b) => Number(a.uid - b.uid)) };
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
      return (["INBOX", "IMPORTANT", "STARRED"] as const)
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
        const messages = fetched.map((message) => toMetadata(message, uidValidity));
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
          const messages = fetched.map((message) => toMetadata(message, uidValidity));
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
        return toMetadata(fetched[0], uidValidity);
      } finally {
        lock.release();
      }
    }),
  };
}
