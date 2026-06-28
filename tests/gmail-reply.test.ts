import { describe, expect, it, vi } from "vitest";
import { sendGmailThreadReply } from "../src/lib/mailboxes/gmail-reply";

const sentMetadata = {
  uid: BigInt(101),
  uidValidity: BigInt(202),
  gmailMessageId: "gmail-message-1",
  gmailThreadId: "thread-1",
  rfcMessageId: "<mockupai-reply-fixed@example.test>",
  internalDate: new Date("2026-06-25T00:00:00Z"),
  flags: [],
  labels: ["\\Sent"],
};

describe("Gmail thread reply sender", () => {
  it("sends through Gmail SMTP with thread-preserving headers and returns safe metadata", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["customer@example.test"] });
    const close = vi.fn();
    const createTransport = vi.fn().mockReturnValue({ sendMail, close });
    const lookupByMessageId = vi.fn().mockResolvedValue(sentMetadata);

    const result = await sendGmailThreadReply({
      credentials: { email: "support@example.test", appPassword: "never-return-me" },
      to: "customer@example.test",
      fromName: "Support Team",
      subject: "Original customer subject",
      text: "Agent reply body",
      gmailThreadId: "thread-1",
      latestExternalMessageId: "<customer-last@example.test>",
      references: ["<customer-first@example.test>"],
      lookupByMessageId,
      createTransport,
      generateMessageId: () => "<mockupai-reply-fixed@example.test>",
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Support Team", address: "support@example.test" },
      to: "customer@example.test",
      subject: "Re: Original customer subject",
      text: "Agent reply body",
      messageId: "<mockupai-reply-fixed@example.test>",
      inReplyTo: "<customer-last@example.test>",
      references: "<customer-first@example.test> <customer-last@example.test>",
    }));
    expect(lookupByMessageId).toHaveBeenCalledWith("<mockupai-reply-fixed@example.test>");
    expect(result).toEqual({
      rfcMessageId: "<mockupai-reply-fixed@example.test>",
      gmailMessageId: "gmail-message-1",
      gmailThreadId: "thread-1",
      uid: BigInt(101),
      uidValidity: BigInt(202),
      internalDate: new Date("2026-06-25T00:00:00Z"),
    });
    expect("appPassword" in result).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects Gmail read-back that is not in Sent or not in the expected thread", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["customer@example.test"] });
    const createTransport = vi.fn().mockReturnValue({ sendMail, close: vi.fn() });
    const base = {
      credentials: { email: "support@example.test", appPassword: "secret" },
      to: "customer@example.test",
      subject: "Subject",
      text: "Body",
      gmailThreadId: "thread-1",
      latestExternalMessageId: "<customer@example.test>",
      references: [],
      createTransport,
      generateMessageId: () => "<mockupai-reply-fixed@example.test>",
    };

    await expect(sendGmailThreadReply({
      ...base,
      lookupByMessageId: vi.fn().mockResolvedValue({ ...sentMetadata, labels: [] }),
    })).rejects.toThrow("gmail_reply_not_in_sent");

    await expect(sendGmailThreadReply({
      ...base,
      lookupByMessageId: vi.fn().mockResolvedValue({ ...sentMetadata, gmailThreadId: "other-thread" }),
    })).rejects.toThrow("gmail_reply_thread_mismatch");
  });

  it("polls boundedly until Gmail Sent exposes the generated Message-ID", async () => {
    const lookupByMessageId = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sentMetadata);

    await expect(sendGmailThreadReply({
      credentials: { email: "support@example.test", appPassword: "secret" },
      to: "customer@example.test",
      subject: "Subject",
      text: "Body",
      gmailThreadId: "thread-1",
      latestExternalMessageId: "<customer@example.test>",
      references: [],
      lookupByMessageId,
      createTransport: vi.fn().mockReturnValue({
        sendMail: vi.fn().mockResolvedValue({ accepted: ["customer@example.test"] }),
        close: vi.fn(),
      }),
      generateMessageId: () => "<mockupai-reply-fixed@example.test>",
      readbackAttempts: 3,
      readbackDelayMs: 0,
    })).resolves.toMatchObject({ gmailThreadId: "thread-1" });

    expect(lookupByMessageId).toHaveBeenCalledTimes(3);
  });
});
