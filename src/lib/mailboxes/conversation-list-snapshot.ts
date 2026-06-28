export type MailboxConversationListRow = {
  id: string;
  mailboxId: string;
  rtTicketId: number;
  subject: string | null;
  status: string;
  isUnread: boolean;
  articleCount: number;
  senderName: string | null;
  senderEmail: string | null;
  lastActivityAt: Date | null;
  rtCreatedAt: Date | null;
  rtLastUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  labels: Array<{
    label: {
      id: string;
      name: string;
      type: "USER" | "INBOX" | "IMPORTANT" | "STARRED";
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

  return {
    id: row.rtTicketId,
    mailboxId: row.mailboxId,
    number: String(row.rtTicketId),
    subject: row.subject?.trim() || "(no subject)",
    status: row.status,
    updatedAt: updatedAt.toISOString(),
    createdAt: createdAt.toISOString(),
    articleCount: row.articleCount,
    fromName: row.senderName?.trim() || row.senderEmail?.trim() || "Unknown sender",
    fromEmail: row.senderEmail?.trim() || "",
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
