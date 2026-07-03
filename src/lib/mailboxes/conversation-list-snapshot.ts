export type MailboxConversationListRow = {
  id: string;
  mailboxId: string;
  rtTicketId: number | null;
  subject: string | null;
  status: string;
  isUnread: boolean;
  articleCount: number;
  senderName: string | null;
  senderEmail: string | null;
  latestMessagePreview?: string | null;
  lastActivityAt: Date | null;
  rtCreatedAt: Date | null;
  rtLastUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  labels: Array<{
    label: {
      id: string;
      name: string;
      type: "USER" | "INBOX" | "SENT" | "IMPORTANT" | "STARRED";
      isMutable: boolean;
      state: string;
    };
  }>;
  internalNotes?: Array<{
    id: string;
    body: string;
    createdAt: Date;
  }>;
  responseMetric?: {
    responseStartedAt: Date;
    latestAdminReplyAt: Date | null;
    responseDurationMs: bigint | number | string | null;
  } | null;
};

export function normalizeMailboxConversationListRow(row: MailboxConversationListRow) {
  const updatedAt = row.lastActivityAt ?? row.rtLastUpdatedAt ?? row.updatedAt;
  const createdAt = row.rtCreatedAt ?? row.createdAt;
  const conversationId = row.rtTicketId == null ? `gmail:${row.id}` : String(row.rtTicketId);
  const latestMessagePreview = row.latestMessagePreview?.trim() || null;

  return {
    id: conversationId,
    mailboxId: row.mailboxId,
    number: conversationId,
    subject: row.subject?.trim() || "(no subject)",
    status: row.status,
    updatedAt: updatedAt.toISOString(),
    createdAt: createdAt.toISOString(),
    articleCount: row.articleCount,
    fromName: row.senderName?.trim() || row.senderEmail?.trim() || "Unknown sender",
    fromEmail: row.senderEmail?.trim() || "",
    ...(latestMessagePreview ? { latestMessagePreview } : {}),
    labels: row.labels.map((join) => ({
      id: join.label.id,
      name: join.label.name,
      type: join.label.type,
      mutable: join.label.isMutable,
      state: join.label.state,
    })),
    internalNotes: (row.internalNotes ?? []).map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
    responseMetric: row.responseMetric
      ? {
          responseStartedAt: row.responseMetric.responseStartedAt.toISOString(),
          latestAdminReplyAt: row.responseMetric.latestAdminReplyAt?.toISOString() ?? null,
          responseDurationMs: row.responseMetric.responseDurationMs?.toString() ?? null,
        }
      : null,
    unread: row.isUnread,
    customerId: row.rtTicketId,
  };
}
