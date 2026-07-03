import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { findMailgateIdentity, getTicket, setTicketGmailLabels } from "@/lib/rt/client";
import { provisionMailbox } from "@/lib/rt/provisioning";
import { getDecryptedAppPassword } from "./credentials";
import { htmlToReadableText, isHtmlEmail } from "./email-body-renderer";
import { createGmailAdapter } from "./gmail-client";
import { parseEmailIdentity } from "./identity";
import { durationMsBetween, mailboxResponseMetrics } from "./response-metrics";
import { enqueueGmailLabelOperation } from "./queue";
import { writeRuntimeMailboxConfig } from "./runtime-config";
import type { GmailLabelDescriptor, GmailMessageMetadata } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_RUNTIME_DIR = process.env.MAILBOX_RUNTIME_DIR ?? "/run/mockupai-mailboxes";
const GETMAIL_TIMEOUT_MS = Number(process.env.MAILBOX_GETMAIL_TIMEOUT_MS ?? 600_000);
const MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS = Number(process.env.MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS ?? 60_000);
const MAILBOX_SYNC_LEASE_MS = Number(process.env.MAILBOX_SYNC_LEASE_MS ?? 90_000);
const RECENT_ORPHAN_BACKFILL_LIMIT = Number(process.env.MAILBOX_RECENT_ORPHAN_BACKFILL_LIMIT ?? 0);
const ORPHAN_BACKFILL_FETCH_BATCH_SIZE = Number(process.env.MAILBOX_ORPHAN_BACKFILL_FETCH_BATCH_SIZE ?? 100);

export interface MailboxSyncDeps {
  findMailbox(mailboxId: string): Promise<SyncMailboxRecord | null>;
  getAppPassword(mailboxId: string): Promise<string>;
  scanInbox(input: {
    email: string;
    appPassword: string;
    initialSyncAfter: Date;
    lastCommittedUid: bigint;
  }): Promise<{ uidValidity: bigint; messages: GmailMessageMetadata[] }>;
  scanSent?(input: {
    email: string;
    appPassword: string;
    initialSyncAfter: Date;
  }): Promise<{ uidValidity: bigint; messages: GmailMessageMetadata[] }>;
  loadSkippedSenders?(mailboxId: string): Promise<Set<string>>;
  moveInboxMessagesToSpam?(input: {
    email: string;
    appPassword: string;
    uids: number[];
  }): Promise<void>;
  discoverLabels(input: { email: string; appPassword: string }): Promise<GmailLabelDescriptor[]>;
  persistLabelCatalog(mailboxId: string, labels: GmailLabelDescriptor[]): Promise<void>;
  reconcileInboxState(input: {
    mailbox: SyncMailboxRecord;
    messages: GmailMessageMetadata[];
  }): Promise<void>;
  persist(input: {
    mailbox: SyncMailboxRecord;
    uidValidity: bigint;
    messages: GmailMessageMetadata[];
  }): Promise<{
    imported: number;
    inherited: number;
    lastCommittedUid: bigint;
    responseMetricInputs: Array<{
      tenantId: string;
      storeId: string;
      mailboxId: string;
      conversationId: string;
      messageAt: Date;
    }>;
    adminReplyMetricInputs: Array<{
      conversationId: string;
      actorUserId: string | null;
      repliedAt: Date;
    }>;
  }>;
  recordCustomerMessage(input: {
    tenantId: string;
    storeId: string;
    mailboxId: string;
    conversationId: string;
    messageAt: Date;
  }): Promise<unknown>;
  recordAdminReply(input: { conversationId: string; actorUserId: string | null; repliedAt: Date }): Promise<unknown>;
  provisionMailbox(mailboxId: string): Promise<
    { status: "ACTIVE"; queueId: number } | { status: "DEGRADED"; errorCode: string }
  >;
  materializeConfig(input: {
    mailbox: SyncMailboxRecord;
    lastCommittedUid: bigint;
  }): Promise<string>;
  runGetmail(configPath: string): Promise<void>;
  acquireLease(mailboxId: string, owner: string, expiresAt: Date): Promise<boolean>;
  releaseLease(mailboxId: string, owner: string): Promise<void>;
  markError(mailboxId: string, code: string, degraded: boolean): Promise<void>;
}

export interface SyncMailboxRecord {
  id: string;
  tenantId: string;
  storeId: string;
  email: string;
  initialSyncAfter: Date;
  rtQueueId: number | null;
  isActive: boolean;
  syncCursor: { lastCommittedUid: bigint; uidValidity: bigint | null } | null;
}

export interface SyncMailboxResult {
  mailboxId: string;
  skipped: boolean;
  imported: number;
  inherited: number;
  lastCommittedUid: bigint;
}

function normalizeObservedLabel(name: string): string {
  return name
    .replace(/^\\/, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US");
}

function isUnreadInboxMessage(message: GmailMessageMetadata): boolean {
  return !message.flags.includes("\\Seen");
}

function isOutboundGmailMessage(message: GmailMessageMetadata): boolean {
  return message.labels.map(normalizeObservedLabel).includes("sent");
}

function summarizeMessagePreview(message: Pick<GmailMessageMetadata, "body" | "contentType">): string | null {
  const body = message.body?.trim();
  if (!body) return null;
  const text = (isHtmlEmail(message.contentType, body) ? htmlToReadableText(body) : body)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function normalizedSenderEmail(message: GmailMessageMetadata): string {
  return message.fromEmail?.trim().toLowerCase() ?? "";
}

function maxMessageUid(messages: GmailMessageMetadata[]): bigint {
  return messages.reduce((max, message) => message.uid > max ? message.uid : max, BigInt(0));
}

function ticketSenderIdentity(ticket: Awaited<ReturnType<typeof getTicket>>) {
  if (!ticket.ok || !ticket.data) return { name: "", email: "" };
  const requestor = Array.isArray(ticket.data.Requestor) ? ticket.data.Requestor[0] : ticket.data.Requestor;
  const raw = requestor?.EmailAddress
    ? `${requestor.Name || requestor.EmailAddress} <${requestor.EmailAddress}>`
    : requestor?.Name || requestor?.id;
  return parseEmailIdentity(raw);
}

export async function backfillRecentOrphanLinks(mailbox: SyncMailboxRecord, appPassword?: string) {
  if (!mailbox.rtQueueId || RECENT_ORPHAN_BACKFILL_LIMIT <= 0) return;
  const startedAt = Date.now();
  const links = await prisma.gmailMessageLink.findMany({
    where: {
      mailboxId: mailbox.id,
      OR: [
        { conversationId: null },
        { conversation: { is: { rtTicketId: null } } },
      ],
      rfcMessageId: { not: null },
      direction: "INBOUND",
    },
    orderBy: [{ gmailInternalDate: "desc" }, { imapUid: "desc" }],
    take: RECENT_ORPHAN_BACKFILL_LIMIT,
    select: {
      id: true,
      gmailThreadId: true,
      rfcMessageId: true,
      imapUid: true,
      gmailInternalDate: true,
      conversationId: true,
    },
  });
  console.log(
    `[MailboxSync] orphan_backfill_start mailboxId=${mailbox.id} queueId=${mailbox.rtQueueId} links=${links.length} limit=${RECENT_ORPHAN_BACKFILL_LIMIT}`,
  );
  if (links.length === 0) return;

  const gmailMessageByUid = new Map<string, GmailMessageMetadata>();
  if (appPassword) {
    const gmail = createGmailAdapter({ email: mailbox.email, appPassword });
    for (let index = 0; index < links.length; index += ORPHAN_BACKFILL_FETCH_BATCH_SIZE) {
      const batch = links.slice(index, index + ORPHAN_BACKFILL_FETCH_BATCH_SIZE);
      const gmailMessages = await gmail.fetchInboxByUids(batch.map((link) => link.imapUid));
      for (const message of gmailMessages.messages) {
        gmailMessageByUid.set(message.uid.toString(), message);
      }
    }
  }

  let checked = 0;
  let found = 0;
  let missing = 0;
  let updated = 0;
  for (const link of links) {
    if (!link.rfcMessageId) continue;
    checked += 1;
    const identity = await findMailgateIdentity({
      messageId: link.rfcMessageId,
      queueId: mailbox.rtQueueId,
    });
    if (!identity) {
      missing += 1;
      continue;
    }
    found += 1;
    const ticket = await getTicket(identity.ticketId);
    const sender = ticketSenderIdentity(ticket);
    const gmailMessage = gmailMessageByUid.get(link.imapUid.toString());
    const gmailUnread = gmailMessage ? isUnreadInboxMessage(gmailMessage) : undefined;
    const senderName = gmailMessage?.fromName ?? sender.name;
    const senderEmail = gmailMessage?.fromEmail ?? sender.email;
    await prisma.$transaction(async (tx) => {
      const inboxLabel = await tx.gmailLabel.findFirst({
        where: { mailboxId: mailbox.id, type: "INBOX", state: "ACTIVE" },
        select: { id: true },
      });
      const existingByThread = await tx.mailboxConversation.findUnique({
        where: {
          mailboxId_gmailThreadId: {
            mailboxId: mailbox.id,
            gmailThreadId: link.gmailThreadId,
          },
        },
      });
      const existingByTicket = await tx.mailboxConversation.findUnique({
        where: {
          mailboxId_rtTicketId: {
            mailboxId: mailbox.id,
            rtTicketId: identity.ticketId,
          },
        },
      });
      const conversationPatch = {
        gmailThreadId: link.gmailThreadId,
        subject: ticket.ok ? ticket.data?.Subject ?? undefined : undefined,
        senderName: senderName || undefined,
        senderEmail: senderEmail || undefined,
        ...(gmailUnread == null ? {} : { isUnread: gmailUnread }),
        rtLastUpdatedAt: link.gmailInternalDate,
        lastActivityAt: link.gmailInternalDate,
      };
      const conversation = existingByThread
        ? await tx.mailboxConversation.update({
            where: { id: existingByThread.id },
            data: {
              rtTicketId: existingByThread.rtTicketId ?? identity.ticketId,
              ...conversationPatch,
            },
          })
        : existingByTicket
          ? await tx.mailboxConversation.update({
              where: { id: existingByTicket.id },
              data: conversationPatch,
            })
          : await tx.mailboxConversation.create({
              data: {
                mailboxId: mailbox.id,
                rtTicketId: identity.ticketId,
                gmailThreadId: link.gmailThreadId,
                subject: conversationPatch.subject ?? null,
                senderName: senderName || null,
                senderEmail: senderEmail || null,
                ...(gmailUnread == null ? {} : { isUnread: gmailUnread }),
                articleCount: 1,
                rtLastUpdatedAt: link.gmailInternalDate,
                lastActivityAt: link.gmailInternalDate,
              },
            });
      if (inboxLabel) {
        await tx.conversationLabel.upsert({
          where: {
            conversationId_labelId: {
              conversationId: conversation.id,
              labelId: inboxLabel.id,
            },
          },
          create: { conversationId: conversation.id, labelId: inboxLabel.id },
          update: { confirmedAt: new Date() },
        });
      }
      await tx.gmailMessageLink.update({
        where: { id: link.id },
        data: {
          conversationId: conversation.id,
          rtTicketId: identity.ticketId,
          rtTransactionId: identity.transactionId,
        },
      });
    });
    updated += 1;
  }
  console.log(
    `[MailboxSync] orphan_backfill_done mailboxId=${mailbox.id} checked=${checked}/${links.length} found=${found} missing=${missing} updated=${updated} gmailFetched=${gmailMessageByUid.size} elapsedMs=${Date.now() - startedAt}`,
  );
}

export async function syncMailbox(
  mailboxId: string,
  deps: MailboxSyncDeps = prismaMailboxSyncDeps,
): Promise<SyncMailboxResult> {
  const startedAt = Date.now();
  let mailbox = await deps.findMailbox(mailboxId);
  if (!mailbox || !mailbox.isActive) {
    console.log(`[MailboxSync] skip mailboxId=${mailboxId} reason=${mailbox ? "inactive" : "missing"}`);
    return { mailboxId, skipped: true, imported: 0, inherited: 0, lastCommittedUid: BigInt(0) };
  }
  console.log(
    `[MailboxSync] start mailboxId=${mailbox.id} storeId=${mailbox.storeId} rtQueueId=${mailbox.rtQueueId ?? "none"} lastCommittedUid=${mailbox.syncCursor?.lastCommittedUid ?? BigInt(0)}`,
  );

  const leaseOwner = randomUUID();
  const acquired = await deps.acquireLease(
    mailbox.id,
    leaseOwner,
    new Date(Date.now() + MAILBOX_SYNC_LEASE_MS),
  );
  if (!acquired) {
    console.log(`[MailboxSync] skip mailboxId=${mailbox.id} reason=lease_active`);
    return {
      mailboxId,
      skipped: true,
      imported: 0,
      inherited: 0,
      lastCommittedUid: mailbox.syncCursor?.lastCommittedUid ?? BigInt(0),
    };
  }

  try {
    if (!mailbox.rtQueueId) {
      console.log(
        `[MailboxSync] auto-provision mailboxId=${mailbox.id} email=${mailbox.email} reason=missing_rt_queue`,
      );
      const provisioned = await deps.provisionMailbox(mailbox.id);
      if (provisioned.status !== "ACTIVE") {
        throw new Error(provisioned.errorCode);
      }
      mailbox = await deps.findMailbox(mailbox.id);
      if (!mailbox || !mailbox.isActive) {
        throw new Error("mailbox_not_found");
      }
    }

    const appPassword = await deps.getAppPassword(mailbox.id);
    const discoveredLabels = await deps.discoverLabels({ email: mailbox.email, appPassword });
    console.log(`[MailboxSync] labels_discovered mailboxId=${mailbox.id} count=${discoveredLabels.length}`);
    await deps.persistLabelCatalog(mailbox.id, discoveredLabels);
    await backfillRecentOrphanLinks(mailbox, appPassword);
    let effectiveLastCommittedUid = mailbox.syncCursor?.lastCommittedUid ?? BigInt(0);
    let scan = await deps.scanInbox({
      email: mailbox.email,
      appPassword,
      initialSyncAfter: mailbox.initialSyncAfter,
      lastCommittedUid: effectiveLastCommittedUid,
    });
    console.log(
      `[MailboxSync] inbox_scanned mailboxId=${mailbox.id} messages=${scan.messages.length} uidValidity=${scan.uidValidity} lastCommittedUid=${effectiveLastCommittedUid}`,
    );
    if (
      mailbox.syncCursor?.uidValidity
      && mailbox.syncCursor.uidValidity !== scan.uidValidity
      && mailbox.syncCursor.lastCommittedUid > BigInt(0)
    ) {
      effectiveLastCommittedUid = BigInt(0);
      scan = await deps.scanInbox({
        email: mailbox.email,
        appPassword,
        initialSyncAfter: mailbox.initialSyncAfter,
        lastCommittedUid: effectiveLastCommittedUid,
      });
      console.log(
        `[MailboxSync] inbox_rescanned mailboxId=${mailbox.id} reason=uid_validity_changed messages=${scan.messages.length} uidValidity=${scan.uidValidity}`,
      );
    }
    const sentScan = deps.scanSent
      ? await deps.scanSent({ email: mailbox.email, appPassword, initialSyncAfter: mailbox.initialSyncAfter })
      : { uidValidity: scan.uidValidity, messages: [] };
    console.log(`[MailboxSync] sent_scanned mailboxId=${mailbox.id} messages=${sentScan.messages.length}`);
    const skippedSenders = deps.loadSkippedSenders
      ? await deps.loadSkippedSenders(mailbox.id)
      : new Set<string>();
    if (skippedSenders.size > 0) {
      const skippedMessages = scan.messages.filter((message) => skippedSenders.has(normalizedSenderEmail(message)));
      if (skippedMessages.length > 0) {
        if (!deps.moveInboxMessagesToSpam) throw new Error("gmail_spam_move_unavailable");
        await deps.moveInboxMessagesToSpam({
          email: mailbox.email,
          appPassword,
          uids: skippedMessages.map((message) => Number(message.uid)),
        });
        console.log(`[MailboxSync] skipped_senders_moved mailboxId=${mailbox.id} count=${skippedMessages.length}`);
        scan = {
          ...scan,
          messages: scan.messages.filter((message) => !skippedMessages.includes(message)),
        };
        if (scan.messages.length === 0) {
          effectiveLastCommittedUid = maxMessageUid(skippedMessages);
        }
      }
    }
    const mailboxAtEffectiveCursor: SyncMailboxRecord = {
      ...mailbox,
      syncCursor: mailbox.syncCursor || effectiveLastCommittedUid > BigInt(0)
        ? { uidValidity: mailbox.syncCursor?.uidValidity ?? null, lastCommittedUid: effectiveLastCommittedUid }
        : null,
    };
    const indexed = await deps.persist({
      mailbox: mailboxAtEffectiveCursor,
      uidValidity: scan.uidValidity,
      messages: [...scan.messages, ...sentScan.messages],
    });
    console.log(
      `[MailboxSync] persisted mailboxId=${mailbox.id} imported=${indexed.imported} inherited=${indexed.inherited} lastCommittedUid=${indexed.lastCommittedUid}`,
    );
    await Promise.all(indexed.responseMetricInputs.map((input) => deps.recordCustomerMessage(input)));
    await deps.reconcileInboxState({
      mailbox: mailboxAtEffectiveCursor,
      messages: scan.messages,
    });
    const hasNewMessages = scan.messages.some((message) => message.uid > effectiveLastCommittedUid);
    if (!hasNewMessages) {
      console.log(`[MailboxSync] done mailboxId=${mailbox.id} reason=no_new_messages elapsedMs=${Date.now() - startedAt}`);
      return { mailboxId, skipped: false, ...indexed };
    }

    const configPath = await deps.materializeConfig({
      mailbox,
      lastCommittedUid: effectiveLastCommittedUid,
    });
    console.log(`[MailboxSync] getmail_start mailboxId=${mailbox.id} config=${basename(configPath)}`);
    await deps.runGetmail(configPath);
    console.log(`[MailboxSync] getmail_done mailboxId=${mailbox.id}`);
    const reconciled = await deps.persist({
      mailbox: mailboxAtEffectiveCursor,
      uidValidity: scan.uidValidity,
      messages: [...scan.messages, ...sentScan.messages],
    });
    await Promise.all(reconciled.responseMetricInputs.map((input) => deps.recordCustomerMessage(input)));
    await deps.reconcileInboxState({
      mailbox: mailboxAtEffectiveCursor,
      messages: scan.messages,
    });
    console.log(
      `[MailboxSync] done mailboxId=${mailbox.id} reason=getmail_completed imported=${indexed.imported} inherited=${indexed.inherited} lastCommittedUid=${reconciled.lastCommittedUid} elapsedMs=${Date.now() - startedAt}`,
    );
    return {
      mailboxId,
      skipped: false,
      imported: indexed.imported,
      inherited: indexed.inherited,
      lastCommittedUid: reconciled.lastCommittedUid,
    };
  } catch (error) {
    const code = safeSyncErrorCode(error);
    console.log(`[MailboxSync] failed mailboxId=${mailboxId} code=${code} elapsedMs=${Date.now() - startedAt}`);
    await deps.markError(mailboxId, code, isPermanentSyncError(code));
    throw error;
  } finally {
    if (mailbox) await deps.releaseLease(mailbox.id, leaseOwner).catch(() => undefined);
  }
}

function safeSyncErrorCode(error: unknown): string {
  if (error instanceof Error && error.message && /^[a-z0-9_:-]+$/i.test(error.message)) {
    return error.message.slice(0, 120);
  }
  return "mailbox_sync_failed";
}

function isPermanentSyncError(code: string): boolean {
  return [
    "gmail_auth_failed",
    "gmail_extension_missing",
    "getmail_not_found",
    "mailbox_secret_missing",
    "mailbox_secret_invalid",
    "invalid_mailbox_email",
    "invalid_sync_date",
  ].includes(code);
}

export const prismaMailboxSyncDeps: MailboxSyncDeps = {
  findMailbox: (mailboxId) =>
    prisma.mailbox.findUnique({
      where: { id: mailboxId },
      select: {
        id: true,
        tenantId: true,
        storeId: true,
        email: true,
        initialSyncAfter: true,
        rtQueueId: true,
        isActive: true,
        syncCursor: { select: { lastCommittedUid: true, uidValidity: true } },
      },
    }),

  getAppPassword: getDecryptedAppPassword,
  provisionMailbox: (mailboxId) => provisionMailbox(mailboxId),
  recordCustomerMessage: mailboxResponseMetrics.recordCustomerMessage,
  recordAdminReply: mailboxResponseMetrics.recordAdminReply,

  scanInbox: ({ email, appPassword, initialSyncAfter, lastCommittedUid }) =>
    createGmailAdapter({ email, appPassword }).scanInbox({ initialSyncAfter, lastCommittedUid }),

  scanSent: ({ email, appPassword, initialSyncAfter }) =>
    createGmailAdapter({ email, appPassword }).scanSent({ initialSyncAfter }),

  discoverLabels: ({ email, appPassword }) =>
    createGmailAdapter({ email, appPassword }).listVisibleLabels(),

  loadSkippedSenders: async (mailboxId) => {
    const rows = await prisma.mailboxSkippedSender.findMany({
      where: { mailboxId },
      select: { senderEmail: true },
    });
    return new Set(rows.map((row) => row.senderEmail));
  },

  moveInboxMessagesToSpam: ({ email, appPassword, uids }) =>
    createGmailAdapter({ email, appPassword }).moveInboxMessagesToSpam(uids),

  persistLabelCatalog: async (mailboxId, labels) => {
    const inFlight = await prisma.gmailLabelOperation.findMany({
      where: {
        mailboxId,
        type: { in: ["CREATE", "RENAME", "DELETE"] },
        state: { in: ["PENDING", "RUNNING", "FAILED"] },
      },
      select: { desiredPayload: true, label: { select: { normalizedName: true } } },
    });
    const protectedNames = new Set<string>();
    for (const operation of inFlight) {
      if (operation.label?.normalizedName) protectedNames.add(operation.label.normalizedName);
      const payload = operation.desiredPayload as Record<string, unknown>;
      for (const value of [payload.name, payload.labelName, payload.newName]) {
        if (typeof value === "string") protectedNames.add(value.normalize("NFKC").trim().toLocaleLowerCase("en-US"));
      }
    }
    const syncable = labels.filter((label) => !protectedNames.has(label.normalizedName));
    if (syncable.length === 0) return;
    await prisma.$transaction(
      syncable.map((label) =>
        prisma.gmailLabel.upsert({
          where: {
            mailboxId_normalizedName: {
              mailboxId,
              normalizedName: label.normalizedName,
            },
          },
          create: {
            mailboxId,
            name: label.name,
            normalizedName: label.normalizedName,
            type: label.type,
            isMutable: label.mutable,
            state: "ACTIVE",
            confirmedAt: new Date(),
          },
          update: {
            name: label.name,
            type: label.type,
            isMutable: label.mutable,
            state: "ACTIVE",
            lastErrorCode: null,
            confirmedAt: new Date(),
          },
        }),
      ),
    );
  },

  reconcileInboxState: async ({ mailbox, messages }) => {
    const inboxLabel = await prisma.gmailLabel.findFirst({
      where: {
        mailboxId: mailbox.id,
        type: "INBOX",
        state: "ACTIVE",
      },
      select: { id: true },
    });
    if (!inboxLabel) return;

    const threadIds = [...new Set(messages.map((message) => message.gmailThreadId).filter(Boolean))];
    const conversations = threadIds.length > 0
      ? await prisma.mailboxConversation.findMany({
          where: {
            mailboxId: mailbox.id,
            gmailThreadId: { in: threadIds },
          },
          select: { id: true, gmailThreadId: true },
        })
      : [];
    const conversationIdByThreadId = new Map(
      conversations.map((conversation) => [conversation.gmailThreadId, conversation.id]),
    );

    const inboxConversationIds = new Set<string>();
    const unreadConversationIds = new Set<string>();
    for (const message of messages) {
      const conversationId = conversationIdByThreadId.get(message.gmailThreadId);
      if (!conversationId) continue;
      inboxConversationIds.add(conversationId);
      if (isUnreadInboxMessage(message)) unreadConversationIds.add(conversationId);
    }

    const inboxIds = [...inboxConversationIds];
    const unreadIds = [...unreadConversationIds];

    await prisma.$transaction(async (tx) => {
      if (inboxIds.length > 0) {
        await Promise.all(
          inboxIds.map((conversationId) =>
            tx.conversationLabel.upsert({
              where: {
                conversationId_labelId: {
                  conversationId,
                  labelId: inboxLabel.id,
                },
              },
              create: {
                conversationId,
                labelId: inboxLabel.id,
              },
              update: {
                confirmedAt: new Date(),
              },
            }),
          ),
        );

        await tx.mailboxConversation.updateMany({
          where: {
            mailboxId: mailbox.id,
            id: { in: inboxIds },
          },
          data: { isUnread: false },
        });

        if (unreadIds.length > 0) {
          await tx.mailboxConversation.updateMany({
            where: {
              mailboxId: mailbox.id,
              id: { in: unreadIds },
            },
            data: { isUnread: true },
          });
        }

        await tx.conversationLabel.deleteMany({
          where: {
            labelId: inboxLabel.id,
            conversation: {
              mailboxId: mailbox.id,
            },
            conversationId: { notIn: inboxIds },
          },
        });

        await tx.mailboxConversation.updateMany({
          where: {
            mailboxId: mailbox.id,
            labels: {
              none: {
                labelId: inboxLabel.id,
              },
            },
            id: { notIn: unreadIds },
          },
          data: { isUnread: false },
        });
        return;
      }

      await tx.conversationLabel.deleteMany({
        where: {
          labelId: inboxLabel.id,
          conversation: {
            mailboxId: mailbox.id,
          },
        },
      });
      await tx.mailboxConversation.updateMany({
        where: {
          mailboxId: mailbox.id,
        },
        data: { isUnread: false },
      });
    });
  },

  materializeConfig: async ({ mailbox, lastCommittedUid }) => {
    const config = await writeRuntimeMailboxConfig({
      mailboxId: mailbox.id,
      email: mailbox.email,
      initialSyncAfter: mailbox.initialSyncAfter,
      lastCommittedUid,
    }, DEFAULT_RUNTIME_DIR);
    return config.getmailConfigPath;
  },

  runGetmail: async (configPath) => {
    try {
      await execFileAsync(
        "getmail",
        [`--getmaildir=${dirname(configPath)}`, `--rcfile=${basename(configPath)}`],
        {
          timeout: GETMAIL_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          env: { ...process.env, GETMAIL_VERBOSE: "0" },
        },
      );
    } catch (error) {
      const timedOut = error instanceof Error && "killed" in error && error.killed === true;
      const missingBinary = error instanceof Error && "code" in error && error.code === "ENOENT";
      throw new Error(missingBinary ? "getmail_not_found" : timedOut ? "getmail_timeout" : "getmail_delivery_failed");
    }
  },

  acquireLease: async (mailboxId, owner, expiresAt) => {
    await prisma.mailboxSyncCursor.upsert({
      where: { mailboxId },
      create: { mailboxId },
      update: {},
    });
    const acquired = await prisma.mailboxSyncCursor.updateMany({
      where: {
        mailboxId,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: new Date() } },
          { leaseOwner: owner },
        ],
      },
      data: { leaseOwner: owner, leaseExpiresAt: expiresAt },
    });
    return acquired.count === 1;
  },

  releaseLease: (mailboxId, owner) =>
    prisma.mailboxSyncCursor.updateMany({
      where: { mailboxId, leaseOwner: owner },
      data: { leaseOwner: null, leaseExpiresAt: null },
    }).then(() => undefined),

  persist: async ({ mailbox, uidValidity, messages }) => {
    if (messages.length === 0) {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          syncStatus: "ACTIVE",
          lastSyncAt: new Date(),
          lastSyncErrorCode: null,
          syncCursor: {
            upsert: {
              create: { uidValidity, lastCommittedUid: mailbox.syncCursor?.lastCommittedUid ?? BigInt(0) },
              update: {
                uidValidity,
                lastCommittedUid: mailbox.syncCursor?.lastCommittedUid ?? BigInt(0),
                lastReconciledAt: new Date(),
              },
            },
          },
        },
      });
      return {
        imported: 0,
        inherited: 0,
        lastCommittedUid: mailbox.syncCursor?.lastCommittedUid ?? BigInt(0),
        responseMetricInputs: [],
        adminReplyMetricInputs: [],
      };
    }

    let imported = 0;
    let inherited = 0;
    let lastCommittedUid = mailbox.syncCursor?.lastCommittedUid ?? BigInt(0);
    let processed = 0;
    let existingLinked = 0;
    let gmailOnly = 0;
    const persistStartedAt = Date.now();
    const inheritedOperationIds: string[] = [];
    const touchedConversationIds = new Set<string>();
    const responseMetricInputs: Array<{
      tenantId: string;
      storeId: string;
      mailboxId: string;
      conversationId: string;
      messageAt: Date;
    }> = [];
    const adminReplyMetricInputs: Array<{
      conversationId: string;
      actorUserId: string | null;
      repliedAt: Date;
    }> = [];
    const latestScannedMessageByConversation = new Map<string, GmailMessageMetadata>();

    console.log(
      `[MailboxSync] persist_start mailboxId=${mailbox.id} messages=${messages.length} cursor=${lastCommittedUid}`,
    );
    for (const message of [...messages].sort((left, right) => Number(right.uid - left.uid))) {
      const existingLink = await prisma.gmailMessageLink.findUnique({
        where: { mailboxId_gmailMessageId: { mailboxId: mailbox.id, gmailMessageId: message.gmailMessageId } },
        select: { conversationId: true, rtTicketId: true, rtTransactionId: true },
      });
      const isExistingLinked = Boolean(existingLink?.conversationId && existingLink.rtTicketId && existingLink.rtTransactionId);
      if (isExistingLinked) existingLinked += 1;
      const committedUid = await prisma.$transaction(
        async (tx) => {
          let link = await tx.gmailMessageLink.findUnique({
            where: { mailboxId_gmailMessageId: { mailboxId: mailbox.id, gmailMessageId: message.gmailMessageId } },
          });
          let conversation = await tx.mailboxConversation.findUnique({
            where: { mailboxId_gmailThreadId: { mailboxId: mailbox.id, gmailThreadId: message.gmailThreadId } },
            include: { labels: { include: { label: true } } },
          });
          if (!conversation) {
            const latestMessagePreview = summarizeMessagePreview(message);
            conversation = await tx.mailboxConversation.create({
              data: {
                mailboxId: mailbox.id,
                gmailThreadId: message.gmailThreadId,
                subject: message.subject?.trim() || null,
                senderName: message.fromName,
                senderEmail: message.fromEmail,
                latestMessagePreview,
                isUnread: isUnreadInboxMessage(message),
                articleCount: 1,
                lastActivityAt: message.internalDate,
              },
              include: { labels: { include: { label: true } } },
            });
            gmailOnly += 1;
          }

          if (!link) {
            const direction = isOutboundGmailMessage(message) ? "OUTBOUND" : "INBOUND";
            link = await tx.gmailMessageLink.create({
              data: {
                mailboxId: mailbox.id,
                conversationId: conversation?.id,
                gmailMessageId: message.gmailMessageId,
                gmailThreadId: message.gmailThreadId,
                rfcMessageId: message.rfcMessageId,
                imapUid: message.uid,
                uidValidity: message.uidValidity,
                rtTicketId: conversation?.rtTicketId,
                direction,
                gmailInternalDate: message.internalDate,
              },
            });
            imported += 1;

            if (conversation?.labels.length) {
              for (const join of conversation.labels) {
                const operation = await tx.gmailLabelOperation.upsert({
                  where: {
                    idempotencyKey: `inherit:${mailbox.id}:${conversation.id}:${join.labelId}:${message.gmailMessageId}`,
                  },
                  create: {
                    mailboxId: mailbox.id,
                    conversationId: conversation.id,
                    labelId: join.labelId,
                    type: "ASSIGN",
                    desiredPayload: { labelName: join.label.name, gmailMessageIds: [message.gmailMessageId] },
                    idempotencyKey: `inherit:${mailbox.id}:${conversation.id}:${join.labelId}:${message.gmailMessageId}`,
                  },
                  update: {},
                });
                if (operation.state === "PENDING") inheritedOperationIds.push(operation.id);
                inherited += 1;
              }
            }
          } else if (conversation && !link.conversationId) {
            link = await tx.gmailMessageLink.update({
              where: { id: link.id },
              data: {
                conversationId: conversation.id,
                rtTicketId: conversation.rtTicketId,
                rtTransactionId: link.rtTransactionId,
              },
            });
          } else {
            const direction = isOutboundGmailMessage(message) ? "OUTBOUND" : "INBOUND";
            if (link.direction !== direction && direction === "OUTBOUND") {
              link = await tx.gmailMessageLink.update({
                where: { id: link.id },
                data: { direction },
              });
            }
          }

          if (!link.conversationId) return null;
          if (link.conversationId) {
            touchedConversationIds.add(link.conversationId);
            const scannedLatest = latestScannedMessageByConversation.get(link.conversationId);
            if (!scannedLatest || message.internalDate.getTime() > scannedLatest.internalDate.getTime()) {
              latestScannedMessageByConversation.set(link.conversationId, message);
            }
            const currentConversation = await tx.mailboxConversation.findUnique({
              where: { id: link.conversationId },
              select: { subject: true, articleCount: true, rtLastUpdatedAt: true, lastActivityAt: true },
            });
            const latestMessagePreview = summarizeMessagePreview(message);
            const isLatestMessage = message.internalDate.getTime()
              >= (currentConversation?.lastActivityAt?.getTime() ?? 0);
            const senderEmail = message.fromEmail?.trim().toLowerCase();
            const mailboxEmail = mailbox.email.trim().toLowerCase();
            if (isOutboundGmailMessage(message)) {
              adminReplyMetricInputs.push({
                conversationId: link.conversationId,
                actorUserId: null,
                repliedAt: message.internalDate,
              });
            } else if (senderEmail && senderEmail !== mailboxEmail) {
              responseMetricInputs.push({
                tenantId: mailbox.tenantId,
                storeId: mailbox.storeId,
                mailboxId: mailbox.id,
                conversationId: link.conversationId,
                messageAt: message.internalDate,
              });
            }
            await tx.mailboxConversation.update({
              where: { id: link.conversationId },
              data: {
                ...(isLatestMessage ? { subject: message.subject?.trim() || currentConversation?.subject } : {}),
                ...(isLatestMessage && message.fromName ? { senderName: message.fromName } : {}),
                ...(isLatestMessage && message.fromEmail ? { senderEmail: message.fromEmail } : {}),
                ...(isLatestMessage ? { isUnread: isUnreadInboxMessage(message) } : {}),
                articleCount: currentConversation && currentConversation.articleCount > 0
                  ? currentConversation.articleCount
                  : 1,
                rtLastUpdatedAt: currentConversation?.rtLastUpdatedAt ?? message.internalDate,
                ...(isLatestMessage ? { lastActivityAt: message.internalDate } : {}),
                ...(latestMessagePreview && isLatestMessage ? { latestMessagePreview } : {}),
              },
            });
            const observedNames = [...new Set(["inbox", ...message.labels.map(normalizeObservedLabel)])];
            const observedLabels = await tx.gmailLabel.findMany({
              where: {
                mailboxId: mailbox.id,
                normalizedName: { in: observedNames },
                state: "ACTIVE",
              },
              select: { id: true },
            });
            for (const label of observedLabels) {
              await tx.conversationLabel.upsert({
                where: {
                  conversationId_labelId: {
                    conversationId: link.conversationId,
                    labelId: label.id,
                  },
                },
                create: { conversationId: link.conversationId, labelId: label.id },
                update: { confirmedAt: new Date() },
              });
            }
          }
          return message.uid;
        },
        { timeout: MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS },
      );
      if (committedUid && committedUid > lastCommittedUid) lastCommittedUid = committedUid;
      processed += 1;
    }

    for (const conversationId of touchedConversationIds) {
      const links = await prisma.gmailMessageLink.findMany({
        where: { mailboxId: mailbox.id, conversationId },
        orderBy: { gmailInternalDate: "asc" },
        select: { direction: true, gmailInternalDate: true, createdAt: true },
      });
      const messageCount = links.length;
      const inbound = links.find((link) => link.direction === "INBOUND");
      const responseStartedAt = inbound?.gmailInternalDate ?? inbound?.createdAt ?? null;
      const latestReply = responseStartedAt
        ? [...links].reverse().find((link) =>
            link.direction === "OUTBOUND"
            && (link.gmailInternalDate ?? link.createdAt).getTime() >= responseStartedAt.getTime()
          )
        : null;
      const latestAdminReplyAt = latestReply ? latestReply.gmailInternalDate ?? latestReply.createdAt : null;
      const latestMessage = [...links].reverse()[0];
      const latestScannedMessage = latestScannedMessageByConversation.get(conversationId);
      const latestMessagePreview = latestScannedMessage ? summarizeMessagePreview(latestScannedMessage) : null;
      if (responseStartedAt) {
        await prisma.mailboxResponseMetric.upsert({
          where: { conversationId },
          create: {
            tenantId: mailbox.tenantId,
            storeId: mailbox.storeId,
            mailboxId: mailbox.id,
            conversationId,
            responseStartedAt,
            latestAdminReplyAt,
            responseDurationMs: latestAdminReplyAt ? durationMsBetween(responseStartedAt, latestAdminReplyAt) : null,
          },
          update: {
            responseStartedAt,
            latestAdminReplyAt,
            latestAdminReplyActorUserId: null,
            responseDurationMs: latestAdminReplyAt ? durationMsBetween(responseStartedAt, latestAdminReplyAt) : null,
          },
        });
      }
      await prisma.mailboxConversation.update({
        where: { id: conversationId },
        data: {
          articleCount: messageCount,
          ...(latestMessage ? { lastActivityAt: latestMessage.gmailInternalDate ?? latestMessage.createdAt } : {}),
          ...(latestMessagePreview ? { latestMessagePreview } : {}),
        },
      });
    }

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        syncStatus: "ACTIVE",
        lastSyncAt: new Date(),
        lastSyncErrorCode: null,
        syncCursor: {
          upsert: {
            create: { uidValidity, lastCommittedUid, lastReconciledAt: new Date() },
            update: { uidValidity, lastCommittedUid, lastReconciledAt: new Date() },
          },
        },
      },
    });

    await Promise.all(inheritedOperationIds.map((operationId) => enqueueGmailLabelOperation(operationId)));
    const touchedConversations = touchedConversationIds.size
      ? await prisma.mailboxConversation.findMany({
          where: { id: { in: [...touchedConversationIds] } },
          select: {
            rtTicketId: true,
            labels: { select: { label: { select: { name: true } } } },
          },
        })
      : [];
    await Promise.all(
      touchedConversations.map((conversation) =>
        conversation.rtTicketId == null
          ? Promise.resolve()
          : setTicketGmailLabels(
              conversation.rtTicketId,
              conversation.labels.map((join) => join.label.name),
            ).then((result) => {
              if (!result.ok) throw new Error(result.error ?? "rt_label_sync_failed");
            }),
      ),
    );
    console.log(
      `[MailboxSync] persist_done mailboxId=${mailbox.id} processed=${processed}/${messages.length} imported=${imported} inherited=${inherited} existingLinked=${existingLinked} gmailOnly=${gmailOnly} touchedConversations=${touchedConversationIds.size} lastCommittedUid=${lastCommittedUid} elapsedMs=${Date.now() - persistStartedAt}`,
    );
    return { imported, inherited, lastCommittedUid, responseMetricInputs, adminReplyMetricInputs };
  },

  markError: (mailboxId, code, degraded) =>
    prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        ...(degraded ? { syncStatus: "DEGRADED" as const } : {}),
        lastSyncErrorCode: code,
      },
    }).then(() => undefined),
};
