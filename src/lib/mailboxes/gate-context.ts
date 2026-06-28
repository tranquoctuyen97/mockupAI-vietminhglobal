import type { GmailMessageMetadata } from "./types";

export interface ReplyGateCandidate {
  to: string;
  subject: string;
  gmailThreadId: string;
  latestExternalMessageId: string;
  references: string[];
}

export function selectReplyGateCandidate(
  messages: GmailMessageMetadata[],
  mailboxEmail?: string,
): ReplyGateCandidate | null {
  const ownEmail = mailboxEmail?.trim().toLowerCase();
  const selected = [...messages]
    .sort((left, right) => right.internalDate.getTime() - left.internalDate.getTime())
    .find((message) => {
      const sender = message.fromEmail?.trim().toLowerCase();
      const subject = message.subject?.trim() ?? "";
      const lowerSubject = subject.toLowerCase();
      return Boolean(
        message.rfcMessageId
        && message.gmailThreadId
        && subject
        && sender
        && sender !== ownEmail
        && !sender.includes("mailer-daemon")
        && !sender.includes("postmaster")
        && !lowerSubject.includes("delivery status notification")
        && !lowerSubject.includes("undeliverable"),
      );
    });
  if (!selected?.rfcMessageId || !selected.fromEmail || !selected.subject) return null;
  return {
    to: selected.fromEmail,
    subject: selected.subject,
    gmailThreadId: selected.gmailThreadId,
    latestExternalMessageId: selected.rfcMessageId,
    references: [],
  };
}
