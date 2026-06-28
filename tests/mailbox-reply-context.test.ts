import { describe, expect, it } from "vitest";
import { buildGmailReplyContext } from "../src/lib/mailboxes/reply-context";

describe("Gmail reply context", () => {
  it("targets the latest customer sender and builds Gmail message references from inbound links", () => {
    const context = buildGmailReplyContext({
      mailboxEmail: "support@example.test",
      ticketId: 42,
      threads: [
        {
          id: 1,
          conversationId: 42,
          subject: "Original customer subject",
          body: "first customer email",
          contentType: "text/plain",
          from: '"Customer One" <customer@example.test>',
          to: "support@example.test",
          type: "correspond",
          internal: false,
          attachments: [],
          createdAt: "2026-06-24T10:00:00.000Z",
        },
        {
          id: 2,
          conversationId: 42,
          subject: "Internal note",
          body: "App-sent Gmail reply recorded",
          contentType: "text/plain",
          from: "support@example.test",
          type: "comment",
          internal: true,
          attachments: [],
          createdAt: "2026-06-24T10:05:00.000Z",
        },
        {
          id: 3,
          conversationId: 42,
          subject: "Re: Original customer subject",
          body: "latest customer reply",
          contentType: "text/plain",
          from: "Customer Two <latest.customer@example.test>",
          to: "support@example.test",
          type: "correspond",
          internal: false,
          attachments: [],
          createdAt: "2026-06-24T10:10:00.000Z",
        },
      ],
      inboundMessageLinks: [
        { rfcMessageId: "<customer-first@example.test>", createdAt: "2026-06-24T10:00:00.000Z" },
        { rfcMessageId: "<customer-last@example.test>", createdAt: "2026-06-24T10:10:00.000Z" },
      ],
    });

    expect(context).toEqual({
      to: "latest.customer@example.test",
      subject: "Re: Original customer subject",
      latestExternalMessageId: "<customer-last@example.test>",
      references: ["<customer-first@example.test>"],
    });
  });

  it("does not return a context when the conversation lacks either a customer sender or Gmail Message-ID", () => {
    expect(buildGmailReplyContext({
      mailboxEmail: "support@example.test",
      ticketId: 42,
      threads: [],
      inboundMessageLinks: [{ rfcMessageId: "<customer@example.test>", createdAt: "2026-06-24T10:00:00.000Z" }],
    })).toBeNull();

    expect(buildGmailReplyContext({
      mailboxEmail: "support@example.test",
      ticketId: 42,
      threads: [{
        id: 1,
        conversationId: 42,
        body: "missing message id",
        contentType: "text/plain",
        from: "customer@example.test",
        type: "correspond",
        internal: false,
        attachments: [],
        createdAt: "2026-06-24T10:00:00.000Z",
      }],
      inboundMessageLinks: [],
    })).toBeNull();
  });
});
