import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { setTicketGmailLabels } from "@/lib/rt/client";
import { provisionMailbox } from "@/lib/rt/provisioning";
import { getDecryptedAppPassword } from "./credentials";
import { createGmailAdapter } from "./gmail-client";
import { mailboxResponseMetrics } from "./response-metrics";
import { enqueueGmailLabelOperation } from "./queue";
import { writeRuntimeMailboxConfig } from "./runtime-config";
import type { GmailLabelDescriptor, GmailMessageMetadata } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_RUNTIME_DIR = process.env.MAILBOX_RUNTIME_DIR ?? "/run/mockupai-mailboxes";
const GETMAIL_TIMEOUT_MS = Number(process.env.MAILBOX_GETMAIL_TIMEOUT_MS ?? 600_000);
const MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS = Number(process.env.MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS ?? 60_000);

export interface MailboxSyncDeps {
  findMailbox(mailboxId: string): Promise<SyncMailboxRecord | null>;
  getAppPassword(mailboxId: string): Promise<string>;
  scanInbox(input: {
    email: string;
    appPassword: string;
    initialSyncAfter: Date;
    lastCommittedUid: bigint;
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
  }>;
  recordCustomerMessage(input: {
    tenantId: string;
    storeId: string;
    mailboxId: string;
    conversationId: string;
    messageAt: Date;
  }): Promise<unknown>;
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

function normalizedSenderEmail(message: GmailMessageMetadata): string {
  return message.fromEmail?.trim().toLowerCase() ?? "";
}

function maxMessageUid(messages: GmailMessageMetadata[]): bigint {
  return messages.reduce((max, message) => message.uid > max ? message.uid : max, BigInt(0));
}

export async function syncMailbox(
  mailboxId: string,
  deps: MailboxSyncDeps = prismaMailboxSyncDeps,
): Promise<SyncMailboxResult> {
  let mailbox = await deps.findMailbox(mailboxId);
  if (!mailbox || !mailbox.isActive) {
    return { mailboxId, skipped: true, imported: 0, inherited: 0, lastCommittedUid: BigInt(0) };
  }

  const leaseOwner = randomUUID();
  const acquired = await deps.acquireLease(
    mailbox.id,
    leaseOwner,
    new Date(Date.now() + 5 * 60_000),
  );
  if (!acquired) {
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
    await deps.persistLabelCatalog(mailbox.id, discoveredLabels);
    let effectiveLastCommittedUid = mailbox.syncCursor?.lastCommittedUid ?? BigInt(0);
    let scan = await deps.scanInbox({
      email: mailbox.email,
      appPassword,
      initialSyncAfter: mailbox.initialSyncAfter,
      lastCommittedUid: BigInt(0),
    });
    if (
      mailbox.syncCursor?.uidValidity
      && mailbox.syncCursor.uidValidity !== scan.uidValidity
      && mailbox.syncCursor.lastCommittedUid > BigInt(0)
    ) {
      effectiveLastCommittedUid = BigInt(0);
    }
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
      messages: scan.messages,
    });
    await Promise.all(indexed.responseMetricInputs.map((input) => deps.recordCustomerMessage(input)));
    await deps.reconcileInboxState({
      mailbox: mailboxAtEffectiveCursor,
      messages: scan.messages,
    });
    const hasNewMessages = scan.messages.some((message) => message.uid > effectiveLastCommittedUid);
    if (!hasNewMessages) {
      return { mailboxId, skipped: false, ...indexed };
    }

    const configPath = await deps.materializeConfig({
      mailbox,
      lastCommittedUid: effectiveLastCommittedUid,
    });
    await deps.runGetmail(configPath);
    const reconciled = await deps.persist({
      mailbox: mailboxAtEffectiveCursor,
      uidValidity: scan.uidValidity,
      messages: scan.messages,
    });
    await Promise.all(reconciled.responseMetricInputs.map((input) => deps.recordCustomerMessage(input)));
    await deps.reconcileInboxState({
      mailbox: mailboxAtEffectiveCursor,
      messages: scan.messages,
    });
    return {
      mailboxId,
      skipped: false,
      imported: indexed.imported,
      inherited: indexed.inherited,
      lastCommittedUid: reconciled.lastCommittedUid,
    };
  } catch (error) {
    const code = safeSyncErrorCode(error);
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

  scanInbox: ({ email, appPassword, initialSyncAfter, lastCommittedUid }) =>
    createGmailAdapter({ email, appPassword }).scanInbox({ initialSyncAfter, lastCommittedUid }),

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
      };
    }

    let imported = 0;
    let inherited = 0;
    let lastCommittedUid = mailbox.syncCursor?.lastCommittedUid ?? BigInt(0);
    const inheritedOperationIds: string[] = [];
    const touchedConversationIds = new Set<string>();
    const responseMetricInputs: Array<{
      tenantId: string;
      storeId: string;
      mailboxId: string;
      conversationId: string;
      messageAt: Date;
    }> = [];

    for (const message of [...messages].sort((left, right) => Number(left.uid - right.uid))) {
      const committedUid = await prisma.$transaction(
        async (tx) => {
          let link = await tx.gmailMessageLink.findUnique({
            where: { mailboxId_gmailMessageId: { mailboxId: mailbox.id, gmailMessageId: message.gmailMessageId } },
          });
          if (!link) {
            const conversation = await tx.mailboxConversation.findUnique({
              where: { mailboxId_gmailThreadId: { mailboxId: mailbox.id, gmailThreadId: message.gmailThreadId } },
              include: { labels: { include: { label: true } } },
            });

            if (conversation && (message.fromName || message.fromEmail)) {
              await tx.mailboxConversation.update({
                where: { id: conversation.id },
                data: {
                  subject: message.subject?.trim() || conversation.subject,
                  senderName: message.fromName ?? conversation.senderName,
                  senderEmail: message.fromEmail ?? conversation.senderEmail,
                  isUnread: isUnreadInboxMessage(message),
                  articleCount: conversation.articleCount > 0 ? conversation.articleCount : 1,
                  rtLastUpdatedAt: conversation.rtLastUpdatedAt ?? message.internalDate,
                  lastActivityAt: message.internalDate,
                },
              });
            }

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
                direction: "INBOUND",
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
          }

          if (!link.conversationId) return null;
          if (link.conversationId) {
            touchedConversationIds.add(link.conversationId);
            const currentConversation = await tx.mailboxConversation.findUnique({
              where: { id: link.conversationId },
              select: { subject: true, articleCount: true, rtLastUpdatedAt: true },
            });
            const senderEmail = message.fromEmail?.trim().toLowerCase();
            const mailboxEmail = mailbox.email.trim().toLowerCase();
            if (senderEmail && senderEmail !== mailboxEmail) {
              responseMetricInputs.push({
                tenantId: mailbox.tenantId,
                storeId: mailbox.storeId,
                mailboxId: mailbox.id,
                conversationId: link.conversationId,
                messageAt: message.internalDate,
              });
            }
            if (message.fromName || message.fromEmail) {
              await tx.mailboxConversation.update({
                where: { id: link.conversationId },
                data: {
                  subject: message.subject?.trim() || currentConversation?.subject,
                  senderName: message.fromName ?? undefined,
                  senderEmail: message.fromEmail ?? undefined,
                  isUnread: isUnreadInboxMessage(message),
                  articleCount: currentConversation && currentConversation.articleCount > 0
                    ? currentConversation.articleCount
                    : 1,
                  rtLastUpdatedAt: currentConversation?.rtLastUpdatedAt ?? message.internalDate,
                  lastActivityAt: message.internalDate,
                },
              });
            } else {
              await tx.mailboxConversation.update({
                where: { id: link.conversationId },
                data: {
                  subject: message.subject?.trim() || currentConversation?.subject,
                  isUnread: isUnreadInboxMessage(message),
                  articleCount: currentConversation && currentConversation.articleCount > 0
                    ? currentConversation.articleCount
                    : 1,
                  rtLastUpdatedAt: currentConversation?.rtLastUpdatedAt ?? message.internalDate,
                  lastActivityAt: message.internalDate,
                },
              });
            }
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
          if (!link.rtTicketId || !link.rtTransactionId) return null;
          return message.uid;
        },
        { timeout: MAILBOX_PERSIST_TRANSACTION_TIMEOUT_MS },
      );
      if (committedUid) lastCommittedUid = committedUid;
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
        setTicketGmailLabels(
          conversation.rtTicketId,
          conversation.labels.map((join) => join.label.name),
        ).then((result) => {
          if (!result.ok) throw new Error(result.error ?? "rt_label_sync_failed");
        }),
      ),
    );
    return { imported, inherited, lastCommittedUid, responseMetricInputs };
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
