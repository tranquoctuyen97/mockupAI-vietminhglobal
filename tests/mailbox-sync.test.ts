import { describe, expect, it, vi } from "vitest";
import { syncMailbox, type MailboxSyncDeps } from "../src/lib/mailboxes/sync";
import type { GmailMessageMetadata } from "../src/lib/mailboxes/types";

function gmailMessage(overrides: Partial<GmailMessageMetadata>): GmailMessageMetadata {
  return {
    uid: BigInt(1),
    uidValidity: BigInt(55),
    gmailMessageId: "gmail-1",
    gmailThreadId: "thread-1",
    rfcMessageId: "<m1@example.com>",
    internalDate: new Date("2026-01-02T00:00:00Z"),
    fromEmail: "customer@example.com",
    flags: [],
    labels: ["\\Inbox"],
    ...overrides,
  };
}

describe("mailbox sync state machine", () => {
  it("scans Inbox from the last committed UID and persists the next cursor", async () => {
    const mailbox = {
      id: "mailbox-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      email: "support@example.com",
      initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
      rtQueueId: null,
      isActive: true,
      syncCursor: { lastCommittedUid: BigInt(41), uidValidity: BigInt(9) },
    };
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue(mailbox),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
      enqueueBackfill: vi.fn().mockResolvedValue(undefined),
      scanInbox: vi.fn().mockResolvedValue({
        uidValidity: BigInt(9),
        messages: [{
          uid: BigInt(42),
          uidValidity: BigInt(9),
          gmailMessageId: "gmail-42",
          gmailThreadId: "thread-1",
          rfcMessageId: "<m42@example.com>",
          internalDate: new Date("2026-01-02T00:00:00Z"),
          flags: [],
          labels: ["\\Inbox"],
        }],
      }),
      discoverLabels: vi.fn().mockResolvedValue([
        { name: "Support/Test", normalizedName: "support/test", type: "USER", mutable: true },
      ]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn()
        .mockResolvedValueOnce({ imported: 1, inherited: 0, lastCommittedUid: BigInt(41), responseMetricInputs: [], adminReplyMetricInputs: [] })
        .mockResolvedValueOnce({ imported: 0, inherited: 0, lastCommittedUid: BigInt(42), responseMetricInputs: [], adminReplyMetricInputs: [] }),
      recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn().mockResolvedValue("/runtime/configs/mailbox-1.getmailrc"),
      runGetmail: vi.fn().mockResolvedValue(undefined),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    const result = await syncMailbox("mailbox-1", deps);

    expect(deps.scanInbox).toHaveBeenCalledWith({
      email: "support@example.com",
      appPassword: "app-pass",
      initialSyncAfter: mailbox.initialSyncAfter,
      lastCommittedUid: BigInt(0),
    });
    expect(deps.provisionMailbox).toHaveBeenCalledWith("mailbox-1");
    expect(deps.enqueueBackfill).toHaveBeenCalledWith("mailbox-1");
    expect(deps.persistLabelCatalog).toHaveBeenCalledWith("mailbox-1", [
      { name: "Support/Test", normalizedName: "support/test", type: "USER", mutable: true },
    ]);
    expect(deps.reconcileInboxState).toHaveBeenCalledTimes(2);
    expect(deps.persist).toHaveBeenCalledTimes(2);
    expect(deps.materializeConfig).toHaveBeenCalledWith({
      mailbox,
      lastCommittedUid: BigInt(41),
    });
    expect(deps.runGetmail).toHaveBeenCalledWith("/runtime/configs/mailbox-1.getmailrc");
    expect(deps.releaseLease).toHaveBeenCalledWith("mailbox-1", expect.any(String));
    expect(result).toEqual({ mailboxId: "mailbox-1", skipped: false, imported: 1, inherited: 0, lastCommittedUid: BigInt(42) });
  });

  it("marks the mailbox degraded with a safe error code", async () => {
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue({
        id: "mailbox-1",
        tenantId: "tenant-1",
        storeId: "store-1",
        email: "support@example.com",
        initialSyncAfter: new Date(),
        rtQueueId: 7,
        isActive: true,
        syncCursor: null,
      }),
      getAppPassword: vi.fn().mockRejectedValue(new Error("gmail_auth_failed")),
      provisionMailbox: vi.fn(),
      scanInbox: vi.fn(),
      discoverLabels: vi.fn(),
      persistLabelCatalog: vi.fn(),
      reconcileInboxState: vi.fn(),
      persist: vi.fn(),
      recordCustomerMessage: vi.fn(),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn(),
      runGetmail: vi.fn(),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    await expect(syncMailbox("mailbox-1", deps)).rejects.toThrow("gmail_auth_failed");
    expect(deps.markError).toHaveBeenCalledWith("mailbox-1", "gmail_auth_failed", true);
  });

  it("persists Inbox messages when Sent scan drops the IMAP connection", async () => {
    const mailbox = {
      id: "mailbox-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      email: "support@example.com",
      initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
      rtQueueId: 7,
      isActive: true,
      syncCursor: { lastCommittedUid: BigInt(1), uidValidity: BigInt(9) },
    };
    const inboxMessage = gmailMessage({ uid: BigInt(1), uidValidity: BigInt(9) });
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue(mailbox),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn(),
      scanInbox: vi.fn().mockResolvedValue({ uidValidity: BigInt(9), messages: [inboxMessage] }),
      scanSent: vi.fn().mockRejectedValue(new Error("Connection not available")),
      discoverLabels: vi.fn().mockResolvedValue([]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockResolvedValue({
        imported: 1,
        inherited: 0,
        lastCommittedUid: BigInt(1),
        responseMetricInputs: [],
        adminReplyMetricInputs: [],
      }),
      recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn(),
      runGetmail: vi.fn(),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    const result = await syncMailbox("mailbox-1", deps);

    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({ messages: [inboxMessage] }));
    expect(deps.markError).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      mailboxId: "mailbox-1",
      skipped: false,
      imported: 1,
      inherited: 0,
      lastCommittedUid: BigInt(1),
    }));
  });

  it("moves skipped sender messages to Spam before getmail", async () => {
    const mailbox = {
      id: "mailbox-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      email: "support@example.com",
      initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
      rtQueueId: 7,
      isActive: true,
      syncCursor: null,
    };
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue(mailbox),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
      scanInbox: vi.fn().mockResolvedValue({
        uidValidity: BigInt(55),
        messages: [
          gmailMessage({ uid: BigInt(10), gmailMessageId: "bad-1", fromEmail: "bad@example.com" }),
          gmailMessage({ uid: BigInt(11), gmailMessageId: "ok-1", fromEmail: "ok@example.com" }),
        ],
      }),
      loadSkippedSenders: vi.fn().mockResolvedValue(new Set(["bad@example.com"])),
      moveInboxMessagesToSpam: vi.fn().mockResolvedValue(undefined),
      discoverLabels: vi.fn().mockResolvedValue([]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn()
        .mockResolvedValueOnce({ imported: 1, inherited: 0, lastCommittedUid: BigInt(0), responseMetricInputs: [], adminReplyMetricInputs: [] })
        .mockResolvedValueOnce({ imported: 0, inherited: 0, lastCommittedUid: BigInt(11), responseMetricInputs: [], adminReplyMetricInputs: [] }),
      recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn().mockResolvedValue("/runtime/configs/mailbox-1.getmailrc"),
      runGetmail: vi.fn().mockResolvedValue(undefined),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    await syncMailbox("mailbox-1", deps);

    expect(deps.moveInboxMessagesToSpam).toHaveBeenCalledWith({
      email: "support@example.com",
      appPassword: "app-pass",
      uids: [10],
    });
    expect(deps.runGetmail).toHaveBeenCalledTimes(1);
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ gmailMessageId: "ok-1" })],
    }));
  });

  it("does not run getmail when skipped sender spam move fails", async () => {
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue({
        id: "mailbox-1",
        tenantId: "tenant-1",
        storeId: "store-1",
        email: "support@example.com",
        initialSyncAfter: new Date(),
        rtQueueId: 7,
        isActive: true,
        syncCursor: null,
      }),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
      scanInbox: vi.fn().mockResolvedValue({
        uidValidity: BigInt(55),
        messages: [gmailMessage({ uid: BigInt(10), gmailMessageId: "bad-1", fromEmail: "bad@example.com" })],
      }),
      loadSkippedSenders: vi.fn().mockResolvedValue(new Set(["bad@example.com"])),
      moveInboxMessagesToSpam: vi.fn().mockRejectedValue(new Error("gmail_spam_move_failed")),
      discoverLabels: vi.fn().mockResolvedValue([]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn(),
      recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn(),
      runGetmail: vi.fn(),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    await expect(syncMailbox("mailbox-1", deps)).rejects.toThrow("gmail_spam_move_failed");
    expect(deps.runGetmail).not.toHaveBeenCalled();
  });

  it("rescans from the configured Inbox window when Gmail UIDVALIDITY changes", async () => {
    const mailbox = {
      id: "mailbox-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      email: "support@example.com",
      initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
      rtQueueId: 7,
      isActive: true,
      syncCursor: { lastCommittedUid: BigInt(41), uidValidity: BigInt(9) },
    };
    const scanInbox = vi.fn()
      .mockResolvedValueOnce({ uidValidity: BigInt(10), messages: [] })
      .mockResolvedValueOnce({ uidValidity: BigInt(10), messages: [] });
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue(mailbox),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
      scanInbox,
      discoverLabels: vi.fn().mockResolvedValue([]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockResolvedValue({ imported: 0, inherited: 0, lastCommittedUid: BigInt(0), responseMetricInputs: [], adminReplyMetricInputs: [] }),
      recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn(),
      runGetmail: vi.fn(),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    await syncMailbox("mailbox-1", deps);

    expect(scanInbox).toHaveBeenCalledTimes(1);
    expect(scanInbox).toHaveBeenNthCalledWith(1, expect.objectContaining({ lastCommittedUid: BigInt(0) }));
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({
      uidValidity: BigInt(10),
      mailbox: expect.objectContaining({
        syncCursor: expect.objectContaining({ lastCommittedUid: BigInt(0) }),
      }),
    }));
  });

  it("skips without touching Gmail when another worker holds the DB lease", async () => {
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue({
        id: "mailbox-1",
        tenantId: "tenant-1",
        storeId: "store-1",
        email: "support@example.com",
        initialSyncAfter: new Date(),
        rtQueueId: 7,
        isActive: true,
        syncCursor: { lastCommittedUid: BigInt(41), uidValidity: BigInt(9) },
      }),
      getAppPassword: vi.fn(),
      provisionMailbox: vi.fn(),
      scanInbox: vi.fn(),
      discoverLabels: vi.fn(),
      persistLabelCatalog: vi.fn(),
      reconcileInboxState: vi.fn(),
      persist: vi.fn(),
      recordCustomerMessage: vi.fn(),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn(),
      runGetmail: vi.fn(),
      acquireLease: vi.fn().mockResolvedValue(false),
      releaseLease: vi.fn(),
      markError: vi.fn(),
    };

    await expect(syncMailbox("mailbox-1", deps)).resolves.toEqual({
      mailboxId: "mailbox-1",
      skipped: true,
      imported: 0,
      inherited: 0,
      lastCommittedUid: BigInt(41),
    });
    expect(deps.getAppPassword).not.toHaveBeenCalled();
    expect(deps.releaseLease).not.toHaveBeenCalled();
  });

  it("records retryable delivery failures without permanently degrading the mailbox", async () => {
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue({
        id: "mailbox-1",
        tenantId: "tenant-1",
        storeId: "store-1",
        email: "support@example.com",
        initialSyncAfter: new Date(),
        rtQueueId: 7,
        isActive: true,
        syncCursor: null,
      }),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
      discoverLabels: vi.fn().mockResolvedValue([]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      scanInbox: vi.fn().mockResolvedValue({
        uidValidity: BigInt(1),
        messages: [{
          uid: BigInt(1),
          uidValidity: BigInt(1),
          gmailMessageId: "gmail-1",
          gmailThreadId: "thread-1",
          rfcMessageId: "<m1@example.test>",
          internalDate: new Date(),
          flags: [],
          labels: ["\\Inbox"],
        }],
      }),
      persist: vi.fn().mockResolvedValue({ imported: 1, inherited: 0, lastCommittedUid: BigInt(0), responseMetricInputs: [], adminReplyMetricInputs: [] }),
      recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      materializeConfig: vi.fn().mockResolvedValue("/runtime/configs/mailbox-1.getmailrc"),
      runGetmail: vi.fn().mockRejectedValue(new Error("getmail_delivery_failed")),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    await expect(syncMailbox("mailbox-1", deps)).rejects.toThrow("getmail_delivery_failed");
    expect(deps.markError).toHaveBeenCalledWith("mailbox-1", "getmail_delivery_failed", false);
    expect(deps.releaseLease).toHaveBeenCalled();
  });

  it("records a response metric for inbound customer messages linked to conversations", async () => {
    const mailbox = {
      id: "mailbox-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      email: "support@example.com",
      initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
      rtQueueId: 7,
      isActive: true,
      syncCursor: { lastCommittedUid: BigInt(41), uidValidity: BigInt(9) },
    };
    const recordCustomerMessage = vi.fn().mockResolvedValue(undefined);
    const deps: MailboxSyncDeps = {
      findMailbox: vi.fn().mockResolvedValue(mailbox),
      getAppPassword: vi.fn().mockResolvedValue("app-pass"),
      provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
      scanInbox: vi.fn().mockResolvedValue({
        uidValidity: BigInt(9),
        messages: [{
          uid: BigInt(42),
          uidValidity: BigInt(9),
          gmailMessageId: "gmail-42",
          gmailThreadId: "thread-1",
          rfcMessageId: "<m42@example.com>",
          internalDate: new Date("2026-01-02T10:00:00Z"),
          fromEmail: "customer@example.com",
          flags: [],
          labels: ["\\Inbox"],
        }],
      }),
      discoverLabels: vi.fn().mockResolvedValue([]),
      persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
      reconcileInboxState: vi.fn().mockResolvedValue(undefined),
      recordCustomerMessage,
      recordAdminReply: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn()
        .mockResolvedValueOnce({
          imported: 1,
          inherited: 0,
          lastCommittedUid: BigInt(41),
          responseMetricInputs: [{
            tenantId: "tenant-1",
            storeId: "store-1",
            mailboxId: "mailbox-1",
            conversationId: "conversation-1",
            messageAt: new Date("2026-01-02T10:00:00Z"),
          }],
          adminReplyMetricInputs: [],
        })
        .mockResolvedValueOnce({ imported: 0, inherited: 0, lastCommittedUid: BigInt(42), responseMetricInputs: [], adminReplyMetricInputs: [] }),
      materializeConfig: vi.fn().mockResolvedValue("/runtime/configs/mailbox-1.getmailrc"),
      runGetmail: vi.fn().mockResolvedValue(undefined),
      acquireLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn(),
    };

    await syncMailbox("mailbox-1", deps);

    expect(recordCustomerMessage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-01-02T10:00:00Z"),
    });
  });

});
