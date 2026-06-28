import { describe, expect, it, vi } from "vitest";
import { runVerifiedMailgate, type MailgateDependencies } from "../scripts/verified-rt-mailgate";

describe("verified mailgate response metrics", () => {
  it("records a customer response metric when a resolved inbound link gains a conversation", async () => {
    const recordCustomerMessage = vi.fn().mockResolvedValue(undefined);
    const deps: MailgateDependencies = {
      load: vi.fn().mockResolvedValue({ duplicate: false, rtQueueId: 7, gmailMessageLinkId: "link-1" }),
      resolve: vi.fn().mockResolvedValue({ ticketId: 42, transactionId: 1001 }),
      deliver: vi.fn(),
      verify: vi.fn().mockResolvedValue(true),
      persist: vi.fn().mockResolvedValue({
        tenantId: "tenant-1",
        storeId: "store-1",
        mailboxId: "mailbox-1",
        conversationId: "conversation-1",
        messageAt: new Date("2026-06-01T10:00:00Z"),
      }),
      recordCustomerMessage,
    };

    const exitCode = await runVerifiedMailgate({
      mailboxId: "mailbox-1",
      mime: Buffer.from("Message-ID: <customer@example.test>\nSubject: Help\n\nBody"),
    }, deps);

    expect(exitCode).toBe(0);
    expect(recordCustomerMessage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-06-01T10:00:00Z"),
    });
  });
});
