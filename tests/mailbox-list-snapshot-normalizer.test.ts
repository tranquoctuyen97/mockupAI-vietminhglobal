import { normalizeMailboxConversationListRow } from "../src/lib/mailboxes/conversation-list-snapshot";

describe("normalizeMailboxConversationListRow", () => {
  it("maps a DB snapshot row to the existing mailbox list shape", () => {
    const updatedAt = new Date("2026-06-28T06:00:00.000Z");
    const createdAt = new Date("2026-06-28T04:00:00.000Z");

    const result = normalizeMailboxConversationListRow({
      id: "conv_1",
      mailboxId: "mailbox_1",
      rtTicketId: 123,
      subject: "Need help with order",
      status: "active",
      isUnread: true,
      articleCount: 4,
      senderName: "Linh",
      senderEmail: "linh@example.com",
      lastActivityAt: updatedAt,
      rtCreatedAt: createdAt,
      rtLastUpdatedAt: updatedAt,
      createdAt,
      updatedAt,
      labels: [
        {
          label: {
            id: "label_inbox",
            name: "Inbox",
            type: "INBOX",
            isMutable: false,
            state: "ACTIVE",
          },
        },
        {
          label: {
            id: "label_helpdesk",
            name: "Helpdesk",
            type: "USER",
            isMutable: true,
            state: "ACTIVE",
          },
        },
      ],
      internalNotes: [
        { id: "note_1", body: "Check refund", createdAt: new Date("2026-06-28T07:00:00.000Z") },
      ],
      responseMetric: {
        responseStartedAt: new Date("2026-06-28T04:30:00.000Z"),
        latestAdminReplyAt: new Date("2026-06-28T06:30:00.000Z"),
        responseDurationMs: BigInt(7_200_000),
      },
    });

    expect(result).toEqual({
      id: 123,
      mailboxId: "mailbox_1",
      number: "123",
      subject: "Need help with order",
      status: "active",
      updatedAt: "2026-06-28T06:00:00.000Z",
      createdAt: "2026-06-28T04:00:00.000Z",
      articleCount: 4,
      fromName: "Linh",
      fromEmail: "linh@example.com",
      labels: [
        { id: "label_inbox", name: "Inbox", type: "INBOX", mutable: false, state: "ACTIVE" },
        { id: "label_helpdesk", name: "Helpdesk", type: "USER", mutable: true, state: "ACTIVE" },
      ],
      internalNotes: [{ id: "note_1", body: "Check refund", createdAt: "2026-06-28T07:00:00.000Z" }],
      responseMetric: {
        responseStartedAt: "2026-06-28T04:30:00.000Z",
        latestAdminReplyAt: "2026-06-28T06:30:00.000Z",
        responseDurationMs: "7200000",
      },
      unread: true,
      customerId: 123,
    });
  });

  it("uses stable fallbacks for incomplete historical rows", () => {
    const createdAt = new Date("2026-06-28T04:00:00.000Z");

    const result = normalizeMailboxConversationListRow({
      id: "conv_2",
      mailboxId: "mailbox_1",
      rtTicketId: 124,
      subject: null,
      status: "pending",
      isUnread: false,
      articleCount: 0,
      senderName: null,
      senderEmail: null,
      lastActivityAt: null,
      rtCreatedAt: null,
      rtLastUpdatedAt: null,
      createdAt,
      updatedAt: createdAt,
      labels: [],
      internalNotes: [],
      responseMetric: null,
    });

    expect(result.subject).toBe("(no subject)");
    expect(result.updatedAt).toBe("2026-06-28T04:00:00.000Z");
    expect(result.fromName).toBe("Unknown sender");
    expect(result.fromEmail).toBe("");
    expect(result.articleCount).toBe(0);
  });

  it("prefers Gmail activity time over RT repair timestamps for list dates", () => {
    const lastActivityAt = new Date("2026-06-25T00:00:13.000Z");
    const rtLastUpdatedAt = new Date("2026-06-27T07:31:56.000Z");

    const result = normalizeMailboxConversationListRow({
      id: "conv_3",
      mailboxId: "mailbox_1",
      rtTicketId: 125,
      subject: "Gate reply",
      status: "active",
      isUnread: true,
      articleCount: 1,
      senderName: "Customer",
      senderEmail: "customer@example.com",
      lastActivityAt,
      rtCreatedAt: null,
      rtLastUpdatedAt,
      createdAt: rtLastUpdatedAt,
      updatedAt: rtLastUpdatedAt,
      labels: [],
      internalNotes: [],
      responseMetric: null,
    });

    expect(result.updatedAt).toBe("2026-06-25T00:00:13.000Z");
  });
});
