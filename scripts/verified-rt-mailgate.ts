import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { prisma } from "../src/lib/db";
import { mailboxResponseMetrics } from "../src/lib/mailboxes/response-metrics";
import { findMailgateIdentity, getTicket, getTicketTransactions, searchTickets } from "../src/lib/rt/client";

export interface MailgateLoadResult {
  duplicate: boolean;
  rtQueueId: number;
  gmailMessageLinkId: string;
}

export interface MailgateMetricInput {
  tenantId: string;
  storeId: string;
  mailboxId: string;
  conversationId: string;
  messageAt: Date;
}

export interface MailgateDependencies {
  load(mailboxId: string, rfcMessageId: string): Promise<MailgateLoadResult | null>;
  resolve(rfcMessageId: string, queueId: number, waitForMs: number): Promise<{ ticketId: number; transactionId: number } | null>;
  deliver(queueId: number, mime: Buffer): Promise<{ code: number | null; stdout: string; stderr: string }>;
  verify(ticketId: number, transactionId: number, queueId: number): Promise<boolean>;
  persist(input: {
    gmailMessageLinkId: string;
    rtTicketId: number;
    rtTransactionId: number;
    subject: string | null;
  }): Promise<MailgateMetricInput | null>;
  recordCustomerMessage(input: MailgateMetricInput): Promise<unknown>;
}

export function extractRfcMessageId(mime: Buffer): string | null {
  const separator = mime.indexOf("\r\n\r\n");
  const fallback = separator < 0 ? mime.indexOf("\n\n") : separator;
  if (fallback < 0) return null;
  const headers = mime.subarray(0, fallback).toString("latin1");
  return headers.match(/^message-id:\s*(.+?)\s*$/im)?.[1] ?? null;
}

function extractHeader(mime: Buffer, name: string): string | null {
  const separator = mime.indexOf("\r\n\r\n");
  const fallback = separator < 0 ? mime.indexOf("\n\n") : separator;
  if (fallback < 0) return null;
  const headers = mime.subarray(0, fallback).toString("latin1");
  const match = headers.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim() ?? null;
}

function mailgateSucceeded(stdout: string, stderr: string): boolean {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  if (lines.some((line) => line.startsWith("not ok"))) return false;
  return lines.includes("ok");
}

async function persistResolvedIdentity(
  mapping: MailgateLoadResult,
  identity: { ticketId: number; transactionId: number },
  subject: string | null,
  dependencies: MailgateDependencies,
): Promise<boolean> {
  if (!await dependencies.verify(identity.ticketId, identity.transactionId, mapping.rtQueueId)) return false;
  const metricInput = await dependencies.persist({
    gmailMessageLinkId: mapping.gmailMessageLinkId,
    rtTicketId: identity.ticketId,
    rtTransactionId: identity.transactionId,
    subject,
  });
  if (metricInput) {
    await dependencies.recordCustomerMessage(metricInput);
  }
  return true;
}

async function resolveBySubject(queueId: number, subject: string): Promise<{ ticketId: number; transactionId: number } | null> {
  const tickets = await searchTickets({ queueId, pageSize: 100 });
  const matchedTicket = tickets.data?.items
    .filter((ticket) => ticket.subject === subject)
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))[0];
  if (!matchedTicket) return null;
  const ticketId = Number(matchedTicket.id);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return null;
  const transactions = await getTicketTransactions(ticketId);
  const createTransaction = transactions.data?.items.find((transaction) => transaction.type === "create") ?? transactions.data?.items[0];
  if (!createTransaction) return null;
  return { ticketId, transactionId: createTransaction.id };
}

export async function runVerifiedMailgate(
  input: { mailboxId: string; mime: Buffer },
  dependencies: MailgateDependencies,
): Promise<0 | 1 | 75> {
  if (!/^[a-z0-9_-]+$/i.test(input.mailboxId)) return 1;
  const messageId = extractRfcMessageId(input.mime);
  const subject = extractHeader(input.mime, "Subject");
  if (!messageId) return 1;
  try {
    const mapping = await dependencies.load(input.mailboxId, messageId);
    if (!mapping?.rtQueueId) return 75;
    if (mapping.duplicate) return 0;
    const existingIdentity = await dependencies.resolve(messageId, mapping.rtQueueId, 0);
    if (existingIdentity) {
      return await persistResolvedIdentity(mapping, existingIdentity, subject, dependencies) ? 0 : 75;
    }
    const delivery = await dependencies.deliver(mapping.rtQueueId, input.mime);
    if (delivery.code !== 0 || !mailgateSucceeded(delivery.stdout, delivery.stderr)) return 75;
    const identity = await dependencies.resolve(messageId, mapping.rtQueueId, 5_000);
    if (identity) return await persistResolvedIdentity(mapping, identity, subject, dependencies) ? 0 : 75;
    if (!subject) return 75;
    const subjectIdentity = await resolveBySubject(mapping.rtQueueId, subject);
    if (!subjectIdentity) return 75;
    return await persistResolvedIdentity(mapping, subjectIdentity, subject, dependencies) ? 0 : 75;
  } catch {
    return 75;
  }
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const defaults: MailgateDependencies = {
  async load(mailboxId, rfcMessageId) {
    const link = await prisma.gmailMessageLink.findFirst({
      where: { mailboxId, rfcMessageId },
      select: { id: true, rtTicketId: true, rtTransactionId: true, mailbox: { select: { rtQueueId: true } } },
    });
    if (!link?.mailbox.rtQueueId) return null;
    return { duplicate: Boolean(link.rtTicketId && link.rtTransactionId), rtQueueId: link.mailbox.rtQueueId, gmailMessageLinkId: link.id };
  },
  async resolve(rfcMessageId, queueId, waitForMs) {
    const deadline = Date.now() + waitForMs;
    do {
      const identity = await findMailgateIdentity({ messageId: rfcMessageId, queueId });
      if (identity) return identity;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (true);
  },
  deliver(queueId, mime) {
    return new Promise((resolve, reject) => {
      const directMailgatePath = "/opt/rt/bin/rt-mailgate";
      const useDirectMailgate = existsSync(directMailgatePath);
      const rtUrl = useDirectMailgate
        ? process.env.RT_URL
        : process.env.RT_MAILGATE_URL ?? "http://localhost:9000";
      if (!rtUrl) return reject(new Error("rt_url_missing"));
      const mailgateArgs = ["--debug", "--queue", String(queueId), "--action", "correspond", "--url", rtUrl];
      const child = useDirectMailgate
        ? spawn(directMailgatePath, mailgateArgs, {
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        })
        : spawn("docker", [
          "compose",
          "--env-file",
          "infra/rt/.env",
          "-f",
          "infra/rt/docker-compose.yml",
          "exec",
          "-T",
          "rt",
          directMailgatePath,
          ...mailgateArgs,
        ], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      });
      child.stdin.end(mime);
    });
  },
  async verify(ticketId, transactionId, queueId) {
    const [ticket, transactions] = await Promise.all([getTicket(ticketId), getTicketTransactions(ticketId)]);
    const rawQueue = ticket.data?.Queue;
    const actualQueueId = Number(typeof rawQueue === "object" && rawQueue ? rawQueue.id : rawQueue);
    return ticket.ok && actualQueueId === queueId && transactions.ok && Boolean(transactions.data?.items.some((transaction) => transaction.id === transactionId));
  },
  async persist(input) {
    const ticket = await getTicket(input.rtTicketId);
    const ticketData = ticket.ok ? ticket.data : null;
    return prisma.$transaction(async (tx) => {
      const link = await tx.gmailMessageLink.findUniqueOrThrow({
        where: { id: input.gmailMessageLinkId },
        include: { mailbox: { select: { tenantId: true, storeId: true } } },
      });
      const internalDate = link.gmailInternalDate ?? link.createdAt;
      const existingConversation = await tx.mailboxConversation.findFirst({
        where: {
          mailboxId: link.mailboxId,
          OR: [
            { gmailThreadId: link.gmailThreadId },
            { rtTicketId: input.rtTicketId },
          ],
        },
      });
      const snapshot = {
        subject: input.subject?.trim() || ticketData?.Subject || existingConversation?.subject || null,
        articleCount: Math.max(
          existingConversation?.articleCount ?? 0,
          Number(ticketData?.TransactionCount ?? 0),
          1,
        ),
        rtStatus: ticketData?.Status ?? existingConversation?.rtStatus ?? null,
        rtCreatedAt: ticketData?.Created ? new Date(ticketData.Created) : existingConversation?.rtCreatedAt ?? null,
        rtLastUpdatedAt: ticketData?.LastUpdated ? new Date(ticketData.LastUpdated) : internalDate,
        lastActivityAt: internalDate,
      };
      const conversation = existingConversation
        ? await tx.mailboxConversation.update({
            where: { id: existingConversation.id },
            data: snapshot,
          })
        : await tx.mailboxConversation.create({
            data: {
              ...snapshot,
              mailboxId: link.mailboxId,
              rtTicketId: input.rtTicketId,
              gmailThreadId: link.gmailThreadId,
            },
          });
      await tx.gmailMessageLink.update({
        where: { id: link.id },
        data: { conversationId: conversation.id, rtTicketId: input.rtTicketId, rtTransactionId: input.rtTransactionId },
      });
      return {
        tenantId: link.mailbox.tenantId,
        storeId: link.mailbox.storeId,
        mailboxId: link.mailboxId,
        conversationId: conversation.id,
        messageAt: internalDate,
      };
    });
  },
  recordCustomerMessage: mailboxResponseMetrics.recordCustomerMessage,
};

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--mailbox-id");
  const mailboxId = flag >= 0 ? args[flag + 1] : "";
  process.exitCode = await runVerifiedMailgate({ mailboxId, mime: await readStdin() }, defaults);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
