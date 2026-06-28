import { normalizeContentType } from "@/lib/mailboxes/email-body-renderer";
import type { NormalizedThread, RtAttachmentDetail } from "./types";

const APP_REPLY_MARKER = "App-sent Gmail reply recorded.";

function resourceId(value: { id?: string | number } | string | number | undefined): number | null {
  const raw = typeof value === "object" && value ? value.id : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBase64Input(value: string): string {
  return value.replace(/\s+/g, "");
}

export function decodeRtAttachmentContent(value: string | null | undefined): string {
  const raw = value ?? "";
  const normalized = normalizeBase64Input(raw.trim());
  if (!normalized) return "";
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return raw;
  }

  try {
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const reencoded = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/g, "");
    if (reencoded === normalized.replace(/=+$/g, "")) {
      return decoded;
    }
  } catch {
    return raw;
  }

  return raw;
}

function parseRecordedAppReply(body: string): { body: string } | null {
  if (!body.startsWith(APP_REPLY_MARKER)) return null;
  const lines = body.split(/\r?\n/);
  const blankIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  if (blankIndex < 0) return null;
  const replyBody = lines.slice(blankIndex + 1).join("\n").trim();
  if (!replyBody) return null;
  return { body: replyBody };
}

function chooseBestAttachment(attachments: RtAttachmentDetail[]): { body: string; contentType: string } | null {
  const ranked = attachments
    .map((attachment) => ({
      contentType: normalizeContentType(attachment.ContentType),
      body: decodeRtAttachmentContent(attachment.Content),
    }))
    .filter((attachment) => attachment.body.trim().length > 0)
    .sort((left, right) => {
      const leftRank = left.contentType === "text/html" ? 0 : left.contentType === "text/plain" ? 1 : 2;
      const rightRank = right.contentType === "text/html" ? 0 : right.contentType === "text/plain" ? 1 : 2;
      return leftRank - rightRank;
    });

  const candidate = ranked.find((attachment) => attachment.contentType === "text/html")
    ?? ranked.find((attachment) => attachment.contentType === "text/plain")
    ?? null;
  if (!candidate) return null;
  return candidate;
}

export function enrichThreadsForDisplay(input: {
  threads: NormalizedThread[];
  attachments: RtAttachmentDetail[];
  mailboxEmail: string;
  customerEmail?: string | null;
  fallbackSubject?: string | null;
}): NormalizedThread[] {
  const attachmentsByTransaction = new Map<number, RtAttachmentDetail[]>();
  for (const attachment of input.attachments) {
    const transactionId = resourceId(attachment.TransactionId);
    if (!transactionId) continue;
    const list = attachmentsByTransaction.get(transactionId) ?? [];
    list.push(attachment);
    attachmentsByTransaction.set(transactionId, list);
  }

  return input.threads.map((thread) => {
    if (thread.type === "systemerror") {
      return { ...thread, hidden: true, displayType: "system" as const };
    }

    if (thread.internal) {
      const appReply = parseRecordedAppReply(thread.body);
      if (!appReply) {
        return { ...thread, hidden: true, displayType: "internal" as const };
      }

      return {
        ...thread,
        hidden: false,
        displayType: "app_reply" as const,
        body: appReply.body,
        contentType: "text/plain",
        from: input.mailboxEmail,
        sender: input.mailboxEmail,
        to: input.customerEmail ?? thread.to,
        subject: thread.subject || input.fallbackSubject || undefined,
      };
    }

    const preferredBody = chooseBestAttachment(attachmentsByTransaction.get(thread.id) ?? []);
    if (!preferredBody) {
      return { ...thread, hidden: false, displayType: "email" as const };
    }

    return {
      ...thread,
      hidden: false,
      displayType: "email" as const,
      body: preferredBody.body,
      contentType: preferredBody.contentType,
    };
  });
}
