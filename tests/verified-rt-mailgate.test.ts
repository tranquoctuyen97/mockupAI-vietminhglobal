import { describe, expect, it, vi } from "vitest";
import { extractRfcMessageId, runVerifiedMailgate } from "../scripts/verified-rt-mailgate";

const mime = Buffer.from("Message-ID: <gate-1@example.test>\r\nSubject: test\r\n\r\nbody\r\n");

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    load: vi.fn().mockResolvedValue({ duplicate: false, rtQueueId: 7, gmailMessageLinkId: "link-1" }),
    resolve: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ ticketId: 42, transactionId: 99 }),
    deliver: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "debug line\nok\n" }),
    verify: vi.fn().mockResolvedValue(true),
    persist: vi.fn().mockResolvedValue(null),
    recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("verified RT mailgate", () => {
  it("extracts Message-ID only from the header block", () => {
    expect(extractRfcMessageId(mime)).toBe("<gate-1@example.test>");
    expect(extractRfcMessageId(Buffer.from("Subject: x\r\n\r\nMessage-ID: <body@example.test>"))).toBeNull();
  });

  it("verifies and persists an ok delivery", async () => {
    const deps = dependencies();
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, deps as never)).resolves.toBe(0);
    expect(deps.deliver).toHaveBeenCalledWith(7, mime);
    expect(deps.resolve).toHaveBeenNthCalledWith(1, "<gate-1@example.test>", 7, 0);
    expect(deps.resolve).toHaveBeenNthCalledWith(2, "<gate-1@example.test>", 7, 5_000);
    expect(deps.verify).toHaveBeenCalledWith(42, 99, 7);
    expect(deps.persist).toHaveBeenCalledWith({
      gmailMessageLinkId: "link-1",
      rtTicketId: 42,
      rtTransactionId: 99,
      subject: "test",
    });
  });

  it("treats not-ok, timeout, mismatch and DB failures as retryable", async () => {
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, dependencies({ deliver: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "not ok - Permission Denied\n" }) }) as never)).resolves.toBe(75);
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, dependencies({ deliver: vi.fn().mockRejectedValue(new Error("timeout")) }) as never)).resolves.toBe(75);
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, dependencies({ resolve: vi.fn().mockResolvedValue(null) }) as never)).resolves.toBe(75);
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, dependencies({ verify: vi.fn().mockResolvedValue(false) }) as never)).resolves.toBe(75);
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, dependencies({ persist: vi.fn().mockRejectedValue(new Error("db")) }) as never)).resolves.toBe(75);
  });

  it("repairs a crash-after-RT retry without redelivering", async () => {
    const deps = dependencies({
      resolve: vi.fn().mockResolvedValue({ ticketId: 42, transactionId: 99 }),
    });
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, deps as never)).resolves.toBe(0);
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.verify).toHaveBeenCalledWith(42, 99, 7);
    expect(deps.persist).toHaveBeenCalledOnce();
  });

  it("does not redeliver an already-linked message", async () => {
    const deps = dependencies({ load: vi.fn().mockResolvedValue({ duplicate: true, rtQueueId: 7, gmailMessageLinkId: "link-1" }) });
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime }, deps as never)).resolves.toBe(0);
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("returns permanent failure for malformed input", async () => {
    await expect(runVerifiedMailgate({ mailboxId: "mailbox_1", mime: Buffer.from("no headers") }, dependencies() as never)).resolves.toBe(1);
  });
});
