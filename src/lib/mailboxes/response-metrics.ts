import { prisma } from "@/lib/db";
import { getDecryptedAppPassword } from "@/lib/mailboxes/credentials";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";
import type { GmailMessageMetadata } from "@/lib/mailboxes/types";

export const RESPONSE_OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface ResponseMetricShape {
  responseStartedAt: Date;
  latestAdminReplyAt: Date | null;
  latestAdminReplyActorUserId?: string | null;
  responseDurationMs: bigint | null;
  conversation?: {
    rtTicketId: number | null;
    subject: string | null;
    senderName: string | null;
    senderEmail: string | null;
  } | null;
}

export interface ResponseMetricRepository {
  createIfMissing(input: {
    tenantId: string;
    storeId: string;
    mailboxId: string;
    conversationId: string;
    responseStartedAt: Date;
  }): Promise<{ created: boolean }>;
  findByConversationId(
    conversationId: string,
  ): Promise<{ conversationId: string; responseStartedAt: Date } | null>;
  updateAdminReply(input: {
    conversationId: string;
    latestAdminReplyAt: Date;
    latestAdminReplyActorUserId: string;
    responseDurationMs: bigint;
  }): Promise<void>;
  listForSummary(input: {
    tenantId: string;
    storeId?: string;
    mailboxId?: string;
    from?: Date;
    to?: Date;
  }): Promise<ResponseMetricShape[]>;
  listOverdue(input: {
    tenantId: string;
    storeId?: string;
    mailboxId?: string;
    now: Date;
    thresholdMs: number;
  }): Promise<ResponseMetricShape[]>;
  rebuild(input: {
    tenantId?: string;
    mailboxId?: string;
    limit?: number;
    dryRun: boolean;
  }): Promise<{ examined: number; written: number; skipped: number; replied: number }>;
}

export function durationMsBetween(start: Date, end: Date): bigint {
  const duration = end.getTime() - start.getTime();
  if (duration < 0) throw new Error("negative_response_duration");
  return BigInt(duration);
}

export function latestReplyAfterStart(repliedAt: Date[], responseStartedAt: Date): Date | null {
  return repliedAt
    .filter((date) => date.getTime() >= responseStartedAt.getTime())
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

export function classifyResponseMetric(metric: ResponseMetricShape, now = new Date()) {
  const ageMs = metric.responseDurationMs ?? durationMsBetween(metric.responseStartedAt, now);
  return {
    ageMs,
    overdue: ageMs > BigInt(RESPONSE_OVERDUE_THRESHOLD_MS),
    replied: metric.latestAdminReplyAt !== null,
  };
}

export function buildResponseSummary(reportMonth: string, rows: ResponseMetricShape[], now = new Date()) {
  const replied = rows.filter((row) => row.latestAdminReplyAt !== null);
  const completedDurations = replied.map((row) => Number(row.responseDurationMs ?? BigInt(0)));
  const actorMap = new Map<string, { actorUserId: string; repliedConversations: number; averageResponseDurationMs: number | null } & { totalDurationMs: number }>();
  for (const row of replied) {
    const actorUserId = row.latestAdminReplyActorUserId ?? "unassigned";
    const current = actorMap.get(actorUserId) ?? {
      actorUserId,
      repliedConversations: 0,
      averageResponseDurationMs: null,
      totalDurationMs: 0,
    };
    current.repliedConversations += 1;
    current.totalDurationMs += Number(row.responseDurationMs ?? BigInt(0));
    actorMap.set(actorUserId, current);
  }
  return {
    reportMonth,
    totalConversations: rows.length,
    repliedConversations: replied.length,
    unrepliedConversations: rows.length - replied.length,
    overdueConversations: rows.filter((row) => classifyResponseMetric(row, now).overdue).length,
    averageResponseDurationMs: completedDurations.length
      ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length)
      : null,
    maxResponseDurationMs: completedDurations.length ? Math.max(...completedDurations) : null,
    oldestPendingAgeMs: rows
      .filter((row) => row.latestAdminReplyAt === null)
      .map((row) => Number(durationMsBetween(row.responseStartedAt, now)))
      .sort((left, right) => right - left)[0] ?? null,
    actorBreakdown: [...actorMap.values()].map((actor) => ({
      actorUserId: actor.actorUserId,
      repliedConversations: actor.repliedConversations,
      averageResponseDurationMs: actor.repliedConversations
        ? Math.round(actor.totalDurationMs / actor.repliedConversations)
        : null,
    })),
  };
}

export function buildMonthlyResponseSummary(metrics: ResponseMetricShape[], now = new Date()) {
  const grouped = new Map<string, ResponseMetricShape[]>();
  for (const metric of metrics) {
    const month = metric.responseStartedAt.toISOString().slice(0, 7);
    grouped.set(month, [...(grouped.get(month) ?? []), metric]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reportMonth, rows]) => buildResponseSummary(reportMonth, rows, now));
}

export function createResponseMetricService(repository: ResponseMetricRepository) {
  return {
    recordCustomerMessage(input: {
      tenantId: string;
      storeId: string;
      mailboxId: string;
      conversationId: string;
      messageAt: Date;
    }) {
      return repository.createIfMissing({
        tenantId: input.tenantId,
        storeId: input.storeId,
        mailboxId: input.mailboxId,
        conversationId: input.conversationId,
        responseStartedAt: input.messageAt,
      });
    },
    async recordAdminReply(input: { conversationId: string; actorUserId: string; repliedAt: Date }) {
      const metric = await repository.findByConversationId(input.conversationId);
      if (!metric) throw new Error("response_metric_missing");
      await repository.updateAdminReply({
        conversationId: input.conversationId,
        latestAdminReplyAt: input.repliedAt,
        latestAdminReplyActorUserId: input.actorUserId,
        responseDurationMs: durationMsBetween(metric.responseStartedAt, input.repliedAt),
      });
    },
    listForSummary: repository.listForSummary,
    listOverdue: repository.listOverdue,
    rebuild: repository.rebuild,
  };
}

async function rebuildMailboxResponseMetrics(
  input: { tenantId?: string; mailboxId?: string; limit?: number; dryRun: boolean },
) {
  const conversations = await prisma.mailboxConversation.findMany({
    where: {
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
      ...(input.tenantId ? { mailbox: { tenantId: input.tenantId } } : {}),
    },
    include: {
      mailbox: { select: { tenantId: true, storeId: true, email: true } },
      messages: {
        select: {
          direction: true,
          gmailInternalDate: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    ...(input.limit ? { take: input.limit } : {}),
  });

  let written = 0;
  let skipped = 0;
  let replied = 0;
  const inboundMatch = { direction: "INBOUND" as const };
  const outboundMatch = { direction: "OUTBOUND" as const };
  const gmailByMailboxId = new Map<string, ReturnType<typeof createGmailAdapter>>();
  async function gmailForMailbox(mailbox: { id: string; email: string }) {
    const cached = gmailByMailboxId.get(mailbox.id);
    if (cached) return cached;
    const gmail = createGmailAdapter({
      email: mailbox.email,
      appPassword: await getDecryptedAppPassword(mailbox.id),
    });
    gmailByMailboxId.set(mailbox.id, gmail);
    return gmail;
  }
  function gmailTimeline(messages: GmailMessageMetadata[], mailboxEmail: string) {
    const ordered = [...messages].sort((left, right) => left.internalDate.getTime() - right.internalDate.getTime());
    const inbound = ordered.find((message) => message.fromEmail?.trim().toLowerCase() !== mailboxEmail);
    const responseStartedAt = inbound?.internalDate ?? null;
    return {
      responseStartedAt,
      latestAdminReplyAt: responseStartedAt
        ? latestReplyAfterStart(
            ordered
              .filter((message) => message.fromEmail?.trim().toLowerCase() === mailboxEmail)
              .map((message) => message.internalDate),
            responseStartedAt,
          )
        : null,
    };
  }
  for (const conversation of conversations) {
    const inbound = conversation.messages
      .filter((message) => message.direction === inboundMatch.direction)
      .sort((left, right) =>
        (left.gmailInternalDate ?? left.createdAt).getTime()
        - (right.gmailInternalDate ?? right.createdAt).getTime(),
      )[0];
    if (!inbound) {
      skipped += 1;
      continue;
    }
    let responseStartedAt = inbound.gmailInternalDate ?? inbound.createdAt;
    const outbound = latestReplyAfterStart(
      conversation.messages
        .filter((message) => message.direction === outboundMatch.direction)
        .map((message) => message.gmailInternalDate ?? message.createdAt),
      responseStartedAt,
    );
    let latestAdminReplyAt = outbound;
    if (!latestAdminReplyAt) {
      try {
        const gmail = await gmailForMailbox({ id: conversation.mailboxId, email: conversation.mailbox.email });
        const thread = await gmail.fetchThreadMessages(conversation.gmailThreadId);
        const gmailTimes = gmailTimeline(thread.messages, conversation.mailbox.email.trim().toLowerCase());
        responseStartedAt = gmailTimes.responseStartedAt ?? responseStartedAt;
        latestAdminReplyAt = gmailTimes.latestAdminReplyAt;
      } catch (error) {
        console.error(`[MailboxResponseMetrics] gmail_thread_rebuild_failed conversationId=${conversation.id} gmailThreadId=${conversation.gmailThreadId}`, error);
      }
    }
    const responseDurationMs = latestAdminReplyAt
      ? durationMsBetween(responseStartedAt, latestAdminReplyAt)
      : null;
    if (latestAdminReplyAt) replied += 1;
    if (!input.dryRun) {
      await prisma.mailboxResponseMetric.upsert({
        where: { conversationId: conversation.id },
        create: {
          conversationId: conversation.id,
          mailboxId: conversation.mailboxId,
          tenantId: conversation.mailbox.tenantId,
          storeId: conversation.mailbox.storeId,
          responseStartedAt,
          latestAdminReplyAt,
          responseDurationMs,
        },
        update: {
          responseStartedAt,
          latestAdminReplyAt,
          responseDurationMs,
        },
      });
    }
    written += 1;
  }
  return { examined: conversations.length, written, skipped, replied };
}

export const mailboxResponseMetrics = createResponseMetricService({
  async createIfMissing(input) {
    await prisma.mailboxResponseMetric.upsert({
      where: { conversationId: input.conversationId },
      create: input,
      update: {},
    });
    return { created: true };
  },
  async findByConversationId(conversationId) {
    return prisma.mailboxResponseMetric.findUnique({
      where: { conversationId },
      select: { conversationId: true, responseStartedAt: true },
    });
  },
  async updateAdminReply(input) {
    await prisma.mailboxResponseMetric.update({
      where: { conversationId: input.conversationId },
      data: {
        latestAdminReplyAt: input.latestAdminReplyAt,
        latestAdminReplyActorUserId: input.latestAdminReplyActorUserId,
        responseDurationMs: input.responseDurationMs,
      },
    });
  },
  async listForSummary(input) {
    return prisma.mailboxResponseMetric.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...(input.from && input.to ? { responseStartedAt: { gte: input.from, lt: input.to } } : {}),
      },
      select: {
        responseStartedAt: true,
        latestAdminReplyAt: true,
        latestAdminReplyActorUserId: true,
        responseDurationMs: true,
      },
      orderBy: { responseStartedAt: "asc" },
    });
  },
  async listOverdue(input) {
    const cutoff = new Date(input.now.getTime() - input.thresholdMs);
    return prisma.mailboxResponseMetric.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        OR: [
          { latestAdminReplyAt: null, responseStartedAt: { lt: cutoff } },
          { responseDurationMs: { gt: BigInt(input.thresholdMs) } },
        ],
        conversation: {
          status: "active",
          labels: {
            some: {
              label: { type: "INBOX", state: "ACTIVE" },
            },
          },
        },
      },
      select: {
        responseStartedAt: true,
        latestAdminReplyAt: true,
        latestAdminReplyActorUserId: true,
        responseDurationMs: true,
        conversation: {
          select: {
            rtTicketId: true,
            subject: true,
            senderName: true,
            senderEmail: true,
          },
        },
      },
      orderBy: { responseStartedAt: "asc" },
    });
  },
  rebuild: rebuildMailboxResponseMetrics,
});
