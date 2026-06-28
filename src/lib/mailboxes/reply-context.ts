import { parseEmailIdentity } from "@/lib/mailboxes/identity";
import type { NormalizedThread } from "@/lib/rt/types";

export interface ReplyMessageLink {
  rfcMessageId: string | null;
  createdAt: Date | string;
}

export interface GmailReplyContext {
  to: string;
  subject: string;
  latestExternalMessageId: string;
  references: string[];
}

function normalizedAddress(value?: string | null): string {
  return parseEmailIdentity(value).email.toLowerCase();
}

function createdAtMs(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueMessageIds(messageIds: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const messageId of messageIds) {
    const trimmed = messageId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

export function buildGmailReplyContext(input: {
  mailboxEmail: string;
  ticketId: number;
  threads: NormalizedThread[];
  inboundMessageLinks: ReplyMessageLink[];
}): GmailReplyContext | null {
  const mailboxEmail = input.mailboxEmail.trim().toLowerCase();
  const orderedThreads = [...input.threads].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id - right.id;
  });
  const customerThread = [...orderedThreads].reverse().find((thread) => {
    if (thread.internal) return false;
    const from = normalizedAddress(thread.from);
    return Boolean(from) && from !== mailboxEmail;
  });
  const to = normalizedAddress(customerThread?.from);
  if (!to) return null;

  const inboundMessageIds = uniqueMessageIds(
    [...input.inboundMessageLinks]
      .sort((left, right) => createdAtMs(left.createdAt) - createdAtMs(right.createdAt))
      .map((link) => link.rfcMessageId ?? ""),
  );
  const latestExternalMessageId = inboundMessageIds.at(-1);
  if (!latestExternalMessageId) return null;

  return {
    to,
    subject: customerThread?.subject || `Ticket #${input.ticketId}`,
    latestExternalMessageId,
    references: inboundMessageIds.slice(0, -1),
  };
}
