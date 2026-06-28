import { describe, expect, it, vi } from "vitest";
import { createGmailAdapter } from "../src/lib/mailboxes/gmail-client";

function mockClient(overrides: Record<string, unknown> = {}) {
  const release = vi.fn();
  return {
    capabilities: new Map([["X-GM-EXT-1", true]]),
    mailbox: { uidValidity: BigInt(55) },
    connect: vi.fn(),
    logout: vi.fn(),
    on: vi.fn(),
    getMailboxLock: vi.fn().mockResolvedValue({ release }),
    search: vi.fn().mockResolvedValue([1]),
    fetchAll: vi.fn().mockResolvedValue([{
      uid: 1,
      emailId: "msg-1",
      threadId: "thread-1",
      internalDate: new Date("2026-06-01"),
      envelope: {
        subject: "Customer needs help",
        from: [{ name: "Customer", address: "customer@example.test" }],
      },
      flags: new Set<string>(),
      labels: new Set(["\\Inbox", "Support/Test"]),
      headers: Buffer.from("Message-ID: <one@example.com>\r\n"),
    }]),
    fetchOne: vi.fn()
      .mockResolvedValueOnce({ uid: 1, flags: new Set<string>(), labels: new Set(["\\Inbox", "Support/Test"]) })
      .mockResolvedValueOnce({ uid: 1, flags: new Set<string>(), labels: new Set(["\\Inbox"]) }),
    list: vi.fn().mockResolvedValue([]),
    mailboxCreate: vi.fn(),
    mailboxRename: vi.fn(),
    mailboxDelete: vi.fn(),
    messageFlagsAdd: vi.fn(),
    messageFlagsRemove: vi.fn(),
    ...overrides,
  };
}

describe("Gmail IMAP adapter", () => {
  it("scans Inbox metadata without reading the message", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = await adapter.scanInbox({ initialSyncAfter: new Date("2026-01-01"), lastCommittedUid: BigInt(0) });

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(client.search).toHaveBeenCalledWith({ since: new Date("2026-01-01") }, { uid: true });
    expect(client.fetchAll).toHaveBeenCalledWith([1], expect.objectContaining({ flags: true, labels: true, threadId: true, headers: ["message-id"], internalDate: true, envelope: true }), { uid: true });
    expect(client.fetchAll.mock.calls[0][1]).not.toHaveProperty("source");
    expect(result.messages[0]).toMatchObject({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      rfcMessageId: "<one@example.com>",
      subject: "Customer needs help",
      fromEmail: "customer@example.test",
      fromName: "Customer",
      flags: [],
    });
  });

  it("uses Gmail labels without adding Seen and verifies readback", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    await adapter.assignLabel([1], "Support/Test");
    await adapter.unassignLabel([1], "Support/Test");

    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["Support/Test"], { uid: true, useLabels: true });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["Support/Test"], { uid: true, useLabels: true });
    expect(client.messageFlagsAdd).not.toHaveBeenCalledWith(expect.anything(), ["\\Seen"], expect.anything());
  });

  it("rejects Gmail accounts without X-GM-EXT-1", async () => {
    const client = mockClient({ capabilities: new Map() });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);
    await expect(adapter.probe()).rejects.toThrow("gmail_extension_missing");
  });

  it("looks up only a stored Gmail thread in All Mail", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);
    await adapter.lookupKnownThread("thread-1");
    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(client.search).toHaveBeenCalledWith({ threadId: "thread-1" }, { uid: true });
  });

  it("looks up a single message by RFC Message-ID in All Mail for Gmail read-back verification", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = await adapter.lookupByMessageId("<reply@example.com>");

    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(client.search).toHaveBeenCalledWith({ gmailRaw: "rfc822msgid:reply@example.com" }, { uid: true });
    expect(result).toMatchObject({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      rfcMessageId: "<one@example.com>",
    });
  });

  it("marks a known Gmail thread unread by removing Seen from Inbox messages", async () => {
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-06-01"),
        envelope: {
          subject: "Customer needs help",
          from: [{ name: "Customer", address: "customer@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox", "Support/Test"]),
        headers: Buffer.from("Message-ID: <one@example.com>\r\n"),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    await adapter.markThreadUnread("thread-1");

    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(client.search).toHaveBeenCalledWith({ threadId: "thread-1" }, { uid: true });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Seen"], { uid: true });
  });

  it("reports a known Gmail thread as spam by adding Spam and removing Inbox", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    await adapter.reportThreadSpam("thread-1");

    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Spam"], { uid: true, useLabels: true });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Inbox"], { uid: true, useLabels: true });
  });
});
