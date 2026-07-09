import { describe, expect, it, vi } from "vitest";
import { createGmailAdapter, GMAIL_OPERATION_TIMEOUT_MS } from "../src/lib/mailboxes/gmail-client";

function mockClient(overrides: Record<string, unknown> = {}) {
  const release = vi.fn();
  return {
    capabilities: new Map([["X-GM-EXT-1", true]]),
    mailbox: { uidValidity: BigInt(55) },
    authenticated: true,
    usable: true,
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
      source: Buffer.from([
        "Message-ID: <one@example.com>",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        "Latest customer body",
      ].join("\r\n")),
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
  it("uses a socket timeout long enough for Gmail metadata scans", async () => {
    const client = mockClient();
    const createClient = vi.fn(() => client as never);
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, createClient);

    await adapter.probe();

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 120_000,
    }));
  });

  it("times out stuck Gmail operations and logs out the client", async () => {
    vi.useFakeTimers();
    const client = mockClient({ search: vi.fn(() => new Promise(() => undefined)) });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = adapter.scanInbox({ initialSyncAfter: new Date("2026-01-01"), lastCommittedUid: BigInt(0) });
    const assertion = expect(result).rejects.toThrow("gmail_operation_timeout");
    await vi.advanceTimersByTimeAsync(GMAIL_OPERATION_TIMEOUT_MS);

    await assertion;
    expect(client.logout).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("scans Inbox metadata with source for list previews", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = await adapter.scanInbox({ initialSyncAfter: new Date("2026-01-01"), lastCommittedUid: BigInt(0) });

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(client.search).toHaveBeenCalledWith({ since: new Date("2026-01-01") }, { uid: true });
    expect(client.fetchAll).toHaveBeenCalledWith([1], expect.objectContaining({ flags: true, labels: true, threadId: true, headers: ["message-id"], internalDate: true, envelope: true, source: true }), { uid: true });
    expect(result.messages[0]).toMatchObject({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      rfcMessageId: "<one@example.com>",
      subject: "Customer needs help",
      fromEmail: "customer@example.test",
      fromName: "Customer",
      flags: [],
      body: "Latest customer body",
      contentType: "text/plain",
    });
  });

  it("still scans current Inbox metadata when a UID cursor exists", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    await adapter.scanInbox({ initialSyncAfter: new Date("2026-01-01"), lastCommittedUid: BigInt(160) });

    expect(client.search).toHaveBeenCalledWith({ since: new Date("2026-01-01") }, { uid: true });
    expect(client.fetchAll).not.toHaveBeenCalled();
    expect(client.fetchAll).not.toHaveBeenCalledWith("161:*", expect.anything(), { uid: true });
  });

  it("fetches large Inbox scans in UID batches after the cursor", async () => {
    const uids = Array.from({ length: 45 }, (_, index) => index + 1);
    const client = mockClient({
      search: vi.fn().mockResolvedValue(uids),
      fetchAll: vi.fn(async (batch: number[]) => batch.map((uid) => ({
        uid,
        emailId: `msg-${uid}`,
        threadId: `thread-${uid}`,
        internalDate: new Date("2026-06-01"),
        envelope: { subject: `Message ${uid}` },
        flags: new Set<string>(),
        labels: new Set(["\\Inbox"]),
        headers: Buffer.from(`Message-ID: <${uid}@example.com>\r\n`),
        source: Buffer.from("Content-Type: text/plain\r\n\r\nBody"),
      }))),
    });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = await adapter.scanInbox({ initialSyncAfter: new Date("2026-01-01"), lastCommittedUid: BigInt(5) });

    expect(client.fetchAll).toHaveBeenCalledTimes(1);
    expect(client.fetchAll).toHaveBeenCalledWith(uids.slice(25), expect.anything(), { uid: true });
    expect(result.messages).toHaveLength(20);
    expect(result.messages[0].uid).toBe(BigInt(26));
  });

  it("scans Sent metadata from the Gmail Sent mailbox", async () => {
    const client = mockClient({
      list: vi.fn().mockResolvedValue([{ path: "[Gmail]/Sent Mail", specialUse: "\\Sent" }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = await adapter.scanSent({ initialSyncAfter: new Date("2026-01-01") });

    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/Sent Mail");
    expect(client.search).toHaveBeenCalledWith({ since: new Date("2026-01-01") }, { uid: true });
    expect(result.messages[0]?.labels).toContain("sent");
  });

  it("skips Inbox messages with incomplete Gmail metadata instead of failing the sync", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = mockClient({
      search: vi.fn().mockResolvedValue([1, 2]),
      fetchAll: vi.fn().mockResolvedValue([
        { uid: 1, emailId: "msg-1", threadId: "thread-1", internalDate: new Date("2026-06-01"), flags: new Set<string>(), labels: new Set(["\\Inbox"]) },
        { uid: 2, internalDate: new Date("2026-06-02"), flags: new Set<string>(), labels: new Set(["\\Inbox"]) },
      ]),
    });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    const result = await adapter.scanInbox({ initialSyncAfter: new Date("2026-01-01"), lastCommittedUid: BigInt(0) });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].gmailMessageId).toBe("msg-1");
    expect(warn).toHaveBeenCalledWith("[Gmail] Skipping message with incomplete metadata uid=2");
    warn.mockRestore();
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

  it("fetches readable messages for a known Gmail thread from All Mail", async () => {
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([
        {
          uid: 1,
          emailId: "msg-1",
          threadId: "thread-1",
          internalDate: new Date("2026-07-02T08:09:00.000Z"),
          envelope: {
            subject: "xsxwcdsw",
            from: [{ name: "Customer", address: "customer@example.test" }],
            to: [{ name: "Support", address: "support@example.test" }],
          },
          flags: new Set<string>(["\\Seen"]),
          labels: new Set(["\\Inbox"]),
          headers: Buffer.from("Message-ID: <one@example.test>\r\n"),
          source: Buffer.from("From: Customer <customer@example.test>\r\nTo: Support <support@example.test>\r\nSubject: xsxwcdsw\r\nMessage-ID: <one@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello"),
        },
        {
          uid: 2,
          emailId: "msg-2",
          threadId: "thread-1",
          internalDate: new Date("2026-07-02T08:12:50.000Z"),
          envelope: {
            subject: "Re: xsxwcdsw",
            from: [{ name: "Support", address: "support@example.test" }],
            to: [{ name: "Customer", address: "customer@example.test" }],
          },
          flags: new Set<string>(["\\Seen"]),
          labels: new Set(["\\Sent"]),
          headers: Buffer.from("Message-ID: <two@example.test>\r\n"),
          source: Buffer.from("From: Support <support@example.test>\r\nTo: Customer <customer@example.test>\r\nSubject: Re: xsxwcdsw\r\nMessage-ID: <two@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nreply"),
        },
      ]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(client.search).toHaveBeenCalledWith({ threadId: "thread-1" }, { uid: true });
    expect(client.fetchAll).toHaveBeenCalledWith([1], expect.objectContaining({ source: true, envelope: true, threadId: true }), { uid: true });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      rfcMessageId: "<one@example.test>",
      subject: "xsxwcdsw",
      fromEmail: "customer@example.test",
      toEmail: "support@example.test",
      body: "hello",
      contentType: "text/plain",
    });
    expect(result.messages[1]).toMatchObject({
      gmailMessageId: "msg-2",
      body: "reply",
      contentType: "text/plain",
    });
  });

  it("extracts the readable text part from a multipart Gmail message", async () => {
    const source = [
      "From: Customer <customer@example.test>",
      "To: Support <support@example.test>",
      "Subject: xsxwcdsw",
      "Message-ID: <one@example.test>",
      "Content-Type: multipart/alternative; boundary=\"abc123\"",
      "",
      "--abc123",
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "",
      "hello ba",
      "--abc123",
      "Content-Type: text/html; charset=\"UTF-8\"",
      "",
      "<p>hello ba</p>",
      "--abc123--",
      "",
    ].join("\r\n");
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-07-02T08:09:00.000Z"),
        envelope: {
          subject: "xsxwcdsw",
          from: [{ name: "Customer", address: "customer@example.test" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        headers: Buffer.from("Message-ID: <one@example.test>\r\n"),
        source: Buffer.from(source),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(result.messages[0]).toMatchObject({
      body: "<p>hello ba</p>",
      contentType: "text/html",
    });
    expect(result.messages[0].body).not.toContain("--abc123");
  });

  it("decodes encoded MIME parts before rendering Gmail thread messages", async () => {
    const encodedHtml = Buffer.from("<div>Cảnh báo bảo mật</div>", "utf8").toString("base64");
    const source = [
      "From: Google <no-reply@accounts.google.com>",
      "Message-ID: <security@example.test>",
      "Content-Type: multipart/alternative; boundary=\"abc123\"",
      "",
      "--abc123",
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Canh=20bao=20bao=20mat",
      "--abc123",
      "Content-Type: text/html; charset=\"UTF-8\"",
      "Content-Transfer-Encoding: base64",
      "",
      encodedHtml,
      "--abc123--",
      "",
    ].join("\r\n");
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-07-02T08:09:00.000Z"),
        envelope: {
          subject: "Cảnh báo bảo mật",
          from: [{ name: "Google", address: "no-reply@accounts.google.com" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        source: Buffer.from(source),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(result.messages[0]).toMatchObject({
      body: "<div>Cảnh báo bảo mật</div>",
      contentType: "text/html",
    });
    expect(result.messages[0].body).not.toContain(encodedHtml);
  });

  it("parses multipart messages with folded content-type headers", async () => {
    const source = [
      "From: Shopify <no-reply@shopify.com>",
      "Message-ID: <shopify-order@example.test>",
      "Content-Type: multipart/alternative;",
      " boundary=\"shopify-boundary\"",
      "",
      "--shopify-boundary",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Type: text/plain; charset=\"utf-8\"",
      "",
      "=2Ebutton__cell { background: #1990C6; }",
      "Christine Vertin placed order #TM19021 on Apr 25.",
      "--shopify-boundary",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Type: text/html; charset=\"utf-8\"",
      "",
      "<div>Christine Vertin placed order #TM19021</div>",
      "--shopify-boundary--",
      "",
    ].join("\r\n");
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-04-25T12:53:22.000Z"),
        envelope: {
          subject: "[ThreadsMuse] Order #TM19021 placed by Christine Vertin",
          from: [{ name: "ThreadsMuse", address: "no-reply@shopify.com" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        source: Buffer.from(source),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(result.messages[0]).toMatchObject({
      body: "<div>Christine Vertin placed order #TM19021</div>",
      contentType: "text/html",
    });
    expect(result.messages[0].body).not.toContain("--shopify-boundary");
    expect(result.messages[0].body).not.toContain("Content-Transfer-Encoding");
  });

  it("descends into nested multipart Gmail delivery status messages", async () => {
    const source = [
      "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      "Message-ID: <dsn@example.test>",
      "Content-Type: multipart/related; boundary=\"outer\"",
      "",
      "--outer",
      "Content-Type: multipart/alternative; boundary=\"inner\"",
      "",
      "--inner",
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "",
      "Address not found",
      "",
      "The response was:",
      "",
      "DNS Error: DNS type 'mx' lookup of example.test responded with code NXDOMAIN",
      "--inner",
      "Content-Type: text/html; charset=\"UTF-8\"",
      "",
      "<html><body><h1>Address not found</h1><p>Your message wasn't delivered.</p></body></html>",
      "--inner--",
      "--outer--",
      "",
    ].join("\r\n");
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-06-25T06:53:00.000Z"),
        envelope: {
          subject: "Delivery Status Notification (Failure)",
          from: [{ name: "Mail Delivery Subsystem", address: "mailer-daemon@googlemail.com" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        source: Buffer.from(source),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(result.messages[0]).toMatchObject({
      body: "<html><body><h1>Address not found</h1><p>Your message wasn't delivered.</p></body></html>",
      contentType: "text/html",
    });
    expect(result.messages[0].body).not.toContain("multipart/alternative");
    expect(result.messages[0].body).not.toContain("--inner");
    expect(result.messages[0].body).not.toContain("Content-Type:");
  });

  it("decodes quoted-printable UTF-8 bodies without mojibake", async () => {
    const source = [
      "From: Google <no-reply@accounts.google.com>",
      "Message-ID: <security-qp@example.test>",
      "Content-Type: text/html; charset=\"UTF-8\"",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<h1>Ai =C4=91=C3=B3 m=E1=BB=9Bi =C4=91=C4=83ng nh=E1=BA=ADp t=C3=A0i kho=E1=BA=A3n</h1>",
      "",
    ].join("\r\n");
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-07-02T08:09:00.000Z"),
        envelope: {
          subject: "Cảnh báo bảo mật",
          from: [{ name: "Google", address: "no-reply@accounts.google.com" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        source: Buffer.from(source),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(result.messages[0].body).toContain("Ai đó mới đăng nhập tài khoản");
    expect(result.messages[0].body).not.toContain("Ä");
    expect(result.messages[0].body).not.toContain("=C4");
  });

  it("falls back to raw source Message-ID when IMAP headers are missing", async () => {
    const client = mockClient({
      fetchAll: vi.fn().mockResolvedValue([{
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-07-02T08:09:00.000Z"),
        envelope: {
          subject: "xsxwcdsw",
          from: [{ name: "Customer", address: "customer@example.test" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        source: Buffer.from("From: Customer <customer@example.test>\r\nMessage-ID: <source-only@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello"),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

    const result = await adapter.fetchThreadMessages("thread-1");

    expect(result.messages[0].rfcMessageId).toBe("<source-only@example.test>");
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

  it("moves scanned Inbox UIDs to Spam without marking them read", async () => {
    const client = mockClient();
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    await adapter.moveInboxMessagesToSpam([1]);

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Spam"], { uid: true, useLabels: true });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Inbox"], { uid: true, useLabels: true });
    expect(client.messageFlagsAdd).not.toHaveBeenCalledWith(expect.anything(), ["\\Seen"], expect.anything());
  });

  it("moves a known Gmail thread to Trash without changing read state", async () => {
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
        labels: new Set(["\\Inbox", "\\Spam", "Support/Test"]),
        headers: Buffer.from("Message-ID: <one@example.com>\r\n"),
      }]),
    });
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

    await adapter.moveThreadToTrash("thread-1");

    expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Trash"], { uid: true, useLabels: true });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Inbox"], { uid: true, useLabels: true });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Spam"], { uid: true, useLabels: true });
    expect(client.messageFlagsAdd).not.toHaveBeenCalledWith(expect.anything(), ["\\Seen"], expect.anything());
  });
});
