import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { GmailCredentials, GmailMessageMetadata } from "./types";

type TransportFactory = typeof nodemailer.createTransport;

export interface GmailReplyInput {
  credentials: GmailCredentials;
  to: string;
  fromName?: string;
  subject: string;
  text: string;
  gmailThreadId: string;
  latestExternalMessageId: string;
  references: string[];
  lookupByMessageId(messageId: string): Promise<GmailMessageMetadata | null>;
  createTransport?: TransportFactory;
  generateMessageId?: () => string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
}

export interface GmailReplyResult {
  rfcMessageId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  uid: bigint;
  uidValidity: bigint;
  internalDate: Date;
}

function defaultMessageId(): string {
  return `<mockupai-reply-${Date.now()}-${randomUUID()}@mockupai.local>`;
}

function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function referenceHeader(references: string[], latestExternalMessageId: string): string {
  return [...references.filter(Boolean), latestExternalMessageId].join(" ");
}

async function waitForReadback(input: GmailReplyInput, messageId: string) {
  const attempts = Math.max(1, input.readbackAttempts ?? 6);
  const delayMs = Math.max(0, input.readbackDelayMs ?? 2_000);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const found = await input.lookupByMessageId(messageId);
    if (found) return found;
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

export async function sendGmailThreadReply(input: GmailReplyInput): Promise<GmailReplyResult> {
  const messageId = input.generateMessageId?.() ?? defaultMessageId();
  const transport = (input.createTransport ?? nodemailer.createTransport)({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: input.credentials.email, pass: input.credentials.appPassword },
  });

  try {
    await transport.sendMail({
      from: { name: input.fromName ?? input.credentials.email, address: input.credentials.email },
      to: input.to,
      subject: replySubject(input.subject),
      text: input.text,
      messageId,
      inReplyTo: input.latestExternalMessageId,
      references: referenceHeader(input.references, input.latestExternalMessageId),
    });
  } finally {
    transport.close();
  }

  const readback = await waitForReadback(input, messageId);
  if (!readback) throw new Error("gmail_reply_not_found");
  if (!readback.labels.includes("\\Sent")) throw new Error("gmail_reply_not_in_sent");
  if (readback.gmailThreadId !== input.gmailThreadId) throw new Error("gmail_reply_thread_mismatch");

  return {
    rfcMessageId: messageId,
    gmailMessageId: readback.gmailMessageId,
    gmailThreadId: readback.gmailThreadId,
    uid: readback.uid,
    uidValidity: readback.uidValidity,
    internalDate: readback.internalDate,
  };
}
