import { describe, expect, it } from "vitest";
import { selectReplyGateCandidate } from "../src/lib/mailboxes/gate-context";

describe("automatic Gmail Gate C context", () => {
  it("selects the newest Inbox message that has customer, subject and Message-ID metadata", () => {
    const selected = selectReplyGateCandidate([
      {
        uid: BigInt(1),
        uidValidity: BigInt(1),
        gmailMessageId: "older",
        gmailThreadId: "thread-old",
        rfcMessageId: "<old@example.test>",
        internalDate: new Date("2026-06-20T00:00:00Z"),
        subject: "Older",
        fromEmail: "old.customer@example.test",
        fromName: "Old Customer",
        flags: [],
        labels: ["\\Inbox"],
      },
      {
        uid: BigInt(2),
        uidValidity: BigInt(1),
        gmailMessageId: "newer",
        gmailThreadId: "thread-new",
        rfcMessageId: "<new@example.test>",
        internalDate: new Date("2026-06-24T00:00:00Z"),
        subject: "Need help",
        fromEmail: "customer@example.test",
        fromName: "Customer",
        flags: [],
        labels: ["\\Inbox"],
      },
    ]);

    expect(selected).toEqual({
      to: "customer@example.test",
      subject: "Need help",
      gmailThreadId: "thread-new",
      latestExternalMessageId: "<new@example.test>",
      references: [],
    });
  });

  it("ignores the mailbox's own messages and incomplete metadata", () => {
    expect(selectReplyGateCandidate([
      {
        uid: BigInt(1),
        uidValidity: BigInt(1),
        gmailMessageId: "self",
        gmailThreadId: "thread-self",
        rfcMessageId: "<self@example.test>",
        internalDate: new Date(),
        subject: "Self",
        fromEmail: "support@example.test",
        flags: [],
        labels: ["\\Inbox"],
      },
    ], "support@example.test")).toBeNull();
  });

  it("ignores delivery status notification bounce messages", () => {
    expect(selectReplyGateCandidate([
      {
        uid: BigInt(1),
        uidValidity: BigInt(1),
        gmailMessageId: "bounce",
        gmailThreadId: "thread-bounce",
        rfcMessageId: "<bounce@example.test>",
        internalDate: new Date(),
        subject: "Delivery Status Notification (Failure)",
        fromEmail: "mailer-daemon@googlemail.com",
        flags: [],
        labels: ["\\Inbox"],
      },
    ], "support@example.test")).toBeNull();
  });
});
