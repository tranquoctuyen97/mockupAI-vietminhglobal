import { parseEmailIdentity } from "@/lib/mailboxes/identity";
import type {
  AppStatus,
  NormalizedLabel,
  NormalizedConversation,
  NormalizedThread,
  RtTicket,
  RtTransaction,
} from "./types";

export function rtStatusToAppStatus(status: string): AppStatus {
  if (status === "stalled") return "pending";
  if (["resolved", "rejected", "deleted"].includes(status)) return "closed";
  return "active";
}

export const APP_TO_RT_STATUS = {
  active: "new",
  pending: "stalled",
  closed: "resolved",
} as const;

function numericId(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function customFieldValues(ticket: RtTicket, name: string): string[] {
  if (Array.isArray(ticket.CustomFields)) {
    const field = ticket.CustomFields.find((candidate) => candidate.name === name);
    return (field?.values ?? []).filter((value): value is string => typeof value === "string");
  }
  if (ticket.CustomFields && typeof ticket.CustomFields === "object") {
    const value = ticket.CustomFields[name];
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return values.filter((candidate): candidate is string => typeof candidate === "string");
  }
  return [];
}

function requestorIdentity(ticket: RtTicket) {
  const requestor = Array.isArray(ticket.Requestor) ? ticket.Requestor[0] : ticket.Requestor;
  const rawIdentity = requestor?.EmailAddress
    ? `${requestor.Name || requestor.EmailAddress} <${requestor.EmailAddress}>`
    : requestor?.Name || requestor?.id;
  return parseEmailIdentity(rawIdentity);
}

export function normalizeRtTicket(
  ticket: RtTicket,
  mailboxId: string,
  catalog: NormalizedLabel[] = [],
): NormalizedConversation {
  const identity = requestorIdentity(ticket);
  const selectedNames = new Set(customFieldValues(ticket, "Gmail Labels"));

  return {
    id: numericId(ticket.id),
    mailboxId,
    number: String(typeof ticket.EffectiveId === "object" ? ticket.EffectiveId?.id ?? ticket.id : ticket.EffectiveId ?? ticket.id),
    subject: ticket.Subject ?? "(no subject)",
    status: rtStatusToAppStatus(ticket.Status ?? "open"),
    updatedAt: ticket.LastUpdated ?? ticket.Created ?? "",
    createdAt: ticket.Created ?? "",
    articleCount: numericId(ticket.TransactionCount ?? 0),
    fromName: identity.name || undefined,
    fromEmail: identity.email || undefined,
    labels: catalog.filter((label) => selectedNames.has(label.name)),
  };
}

export function normalizeRtTransaction(transaction: RtTransaction): NormalizedThread {
  const ticketResource = transaction.Ticket ?? transaction.Object;
  const ticketId = typeof ticketResource === "object" ? ticketResource?.id : ticketResource;
  const attachments = Array.isArray(transaction.Attachments) ? transaction.Attachments : [];
  return {
    id: numericId(transaction.id),
    conversationId: numericId(ticketId),
    subject: transaction.Subject || undefined,
    body: transaction.Content ?? "",
    contentType: transaction.ContentType ?? "text/plain",
    from: transaction.From || undefined,
    to: transaction.To || undefined,
    cc: transaction.Cc || undefined,
    type: (transaction.Type ?? "Correspond").toLowerCase(),
    sender: transaction.Creator?.Name ?? transaction.Creator?.id,
    internal: transaction.Type === "Comment",
    attachments: attachments.map((attachment) => {
      const preferences: Record<string, string> = {};
      if (attachment.ContentType) preferences["Content-Type"] = attachment.ContentType;
      return {
        id: numericId(attachment.id),
        filename: attachment.Filename ?? "attachment",
        size: String(attachment.ContentLength ?? 0),
        preferences,
      };
    }),
    createdAt: transaction.Created ?? "",
  };
}
