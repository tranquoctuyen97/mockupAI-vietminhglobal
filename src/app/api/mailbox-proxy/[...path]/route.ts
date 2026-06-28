import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getDecryptedAppPassword } from "@/lib/mailboxes/credentials";
import { createLabelOperation, normalizeGmailLabelName } from "@/lib/mailboxes/labels";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";
import { parseEmailIdentity } from "@/lib/mailboxes/identity";
import { sendGmailThreadReply } from "@/lib/mailboxes/gmail-reply";
import { buildGmailReplyContext } from "@/lib/mailboxes/reply-context";
import {
  createLabelSchema,
  renameLabelSchema,
  replaceConversationLabelsSchema,
  replySchema,
  statusSchema,
} from "@/lib/mailboxes/validation";
import {
  comment,
  getTicket,
  getTicketAttachmentDetails,
  getTicketTransactions,
  listTicketsByIds,
  searchTickets,
  updateTicketStatus,
} from "@/lib/rt/client";
import { provisionMailbox } from "@/lib/rt/provisioning";
import { normalizeRtTicket } from "@/lib/rt/normalizers";
import { enrichThreadsForDisplay } from "@/lib/rt/thread-display";
import type { AppStatus } from "@/lib/rt/types";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parsePath(segments: string[]): string {
  return `/${segments.join("/")}`;
}

async function requireStoreAccess(tenantId: string, storeId: string) {
  return prisma.store.findFirst({
    where: { id: storeId, tenantId, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
}

async function requireMailbox(tenantId: string, storeId: string, mailboxId: string) {
  return prisma.mailbox.findFirst({
    where: { id: mailboxId, tenantId, storeId, isActive: true },
    include: {
      labels: {
        where: { state: "ACTIVE" },
        orderBy: { name: "asc" },
        include: { _count: { select: { conversations: true } } },
      },
    },
  });
}

async function requireProvisionedMailbox(tenantId: string, storeId: string, mailboxId: string) {
  const mailbox = await requireMailbox(tenantId, storeId, mailboxId);
  if (!mailbox) return null;
  if (mailbox.rtQueueId) return mailbox;
  console.log(
    `[MailboxProxy] auto-provision mailboxId=${mailbox.id} email=${mailbox.email} storeId=${storeId} reason=missing_rt_queue`,
  );
  const provisioned = await provisionMailbox(mailbox.id);
  if (provisioned.status !== "ACTIVE") return null;
  return requireMailbox(tenantId, storeId, mailboxId);
}

function extractStoreId(searchParams: URLSearchParams): string | NextResponse {
  const raw = searchParams.get("storeId");
  return raw ? raw : errorJson("storeId is required", 422);
}

function extractMailboxId(searchParams: URLSearchParams): string | NextResponse {
  const raw = searchParams.get("mailboxId");
  return raw ? raw : errorJson("mailboxId is required", 422);
}

function pageNumber(value: string | null): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageSize(value: string | null): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 25;
}

function mailboxConversationWhere(input: {
  mailboxId: string;
  status?: AppStatus;
  labelId?: string | null;
}) {
  return {
    mailboxId: input.mailboxId,
    ...(input.status ? { status: input.status } : {}),
    ...(input.labelId
      ? {
          labels: {
            some: {
              labelId: input.labelId,
            },
          },
        }
      : {}),
  };
}

async function loadConversationSenderSnapshots(mailboxId: string, ticketIds: number[]) {
  if (ticketIds.length === 0) {
    return new Map<number, {
      senderName: string | null;
      senderEmail: string | null;
      isUnread: boolean;
      lastActivityAt: Date | null;
      gmailThreadId: string;
    }>();
  }
  const conversations = await prisma.mailboxConversation.findMany({
    where: {
      mailboxId,
      rtTicketId: { in: ticketIds },
    },
    select: {
      rtTicketId: true,
      senderName: true,
      senderEmail: true,
      isUnread: true,
      lastActivityAt: true,
      gmailThreadId: true,
    },
  });
  return new Map(
    conversations.map((conversation) => [
      conversation.rtTicketId,
      {
        senderName: conversation.senderName,
        senderEmail: conversation.senderEmail,
        isUnread: conversation.isUnread,
        lastActivityAt: conversation.lastActivityAt,
        gmailThreadId: conversation.gmailThreadId,
      },
    ]),
  );
}

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const guard = await requireFeature("mailboxes");
  if (guard.response) return guard.response;
  const { session } = guard;

  const { path: pathSegments } = await params;
  if (!pathSegments?.length) return errorJson("Invalid proxy path", 400);

  const proxyPath = parsePath(pathSegments);
  const method = request.method as "GET" | "POST" | "PUT" | "DELETE";

  if (method === "GET" && proxyPath === "/mailboxes") {
    return handleListMailboxes(request, session.tenantId);
  }
  if (method === "GET" && proxyPath === "/conversations") {
    return handleListConversations(request, session.tenantId);
  }
  if (method === "GET" && proxyPath === "/labels") {
    return handleListLabels(request, session.tenantId);
  }
  if (method === "POST" && proxyPath === "/labels") {
    return handleCreateLabel(request, session.tenantId, session.id);
  }

  const labelMatch = proxyPath.match(/^\/labels\/([^/]+)$/);
  if (method === "PUT" && labelMatch) {
    return handleRenameLabel(request, session.tenantId, session.id, labelMatch[1]);
  }
  if (method === "DELETE" && labelMatch) {
    return handleDeleteLabel(request, session.tenantId, session.id, labelMatch[1]);
  }

  const detailMatch = proxyPath.match(/^\/conversations\/(\d+)$/);
  if (method === "GET" && detailMatch) {
    return handleGetConversation(request, session.tenantId, Number(detailMatch[1]));
  }
  if (method === "PUT" && detailMatch) {
    return handleStatusUpdate(request, session.tenantId, session.id, Number(detailMatch[1]));
  }

  const readMatch = proxyPath.match(/^\/conversations\/(\d+)\/read$/);
  if (method === "POST" && readMatch) {
    return handleMarkConversationRead(request, session.tenantId, Number(readMatch[1]));
  }

  const unreadMatch = proxyPath.match(/^\/conversations\/(\d+)\/unread$/);
  if (method === "POST" && unreadMatch) {
    return handleMarkConversationUnread(request, session.tenantId, Number(unreadMatch[1]));
  }

  const spamMatch = proxyPath.match(/^\/conversations\/(\d+)\/report-spam$/);
  if (method === "POST" && spamMatch) {
    return handleReportConversationSpam(request, session.tenantId, session.id, Number(spamMatch[1]));
  }

  const replyMatch = proxyPath.match(/^\/conversations\/(\d+)\/threads$/);
  if (method === "POST" && replyMatch) {
    return handleReply(request, session.tenantId, session.id, Number(replyMatch[1]));
  }

  const labelsMatch = proxyPath.match(/^\/conversations\/(\d+)\/labels$/);
  if (method === "PUT" && labelsMatch) {
    return handleReplaceConversationLabels(request, session.tenantId, session.id, Number(labelsMatch[1]));
  }

  await logAudit({
    actorUserId: session.id,
    tenantId: session.tenantId,
    action: "mailbox.proxy_rejected",
    resourceType: "mailbox_proxy",
    resourceId: proxyPath,
    metadata: { method },
  });
  return errorJson("Forbidden — unsupported proxy route", 403);
}

async function handleListLabels(request: NextRequest, tenantId: string) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox) return errorJson("Forbidden — mailbox not found or inactive", 403);
  const status = request.nextUrl.searchParams.get("status") as AppStatus | null;
  const effectiveStatus =
    status && ["active", "pending", "closed"].includes(status) ? status : undefined;
  const selectedLabelId = request.nextUrl.searchParams.get("labelId");
  const labels = await prisma.gmailLabel.findMany({
    where: { mailboxId: mailbox.id },
    orderBy: { name: "asc" },
  });
  const selectedLabel = selectedLabelId ? labels.find((label) => label.id === selectedLabelId) : undefined;
  if (selectedLabelId && !selectedLabel) return errorJson("Label not found", 404);

  const [statusCounts, labelCounts] = await Promise.all([
    Promise.all(
      (["active", "pending", "closed"] as AppStatus[]).map(async (appStatus) => [
        appStatus,
        await prisma.mailboxConversation.count({
          where: mailboxConversationWhere({
            mailboxId: mailbox.id,
            status: appStatus,
            labelId: selectedLabel?.id ?? null,
          }),
        }),
      ] as const),
    ),
    Promise.all(
      labels.map(async (label) => [
        label.id,
        await prisma.mailboxConversation.count({
          where: mailboxConversationWhere({
            mailboxId: mailbox.id,
            status: effectiveStatus,
            labelId: label.id,
          }),
        }),
      ] as const),
    ),
  ]);

  const statusCountMap = Object.fromEntries(statusCounts) as Record<AppStatus, number>;
  const labelCountMap = new Map(labelCounts);

  return json({
    labels: labels.map((label) => ({
      id: label.id,
      name: label.name,
      type: label.type,
      mutable: label.isMutable,
      state: label.state,
      conversationCount: labelCountMap.get(label.id) ?? 0,
    })),
    statusCounts: statusCountMap,
  });
}

async function handleCreateLabel(request: NextRequest, tenantId: string, actorUserId: string) {
  const parsed = createLabelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  const mailbox = await requireProvisionedMailbox(tenantId, parsed.data.storeId, parsed.data.mailboxId);
  if (!mailbox) return errorJson("Forbidden — mailbox not found or inactive", 403);

  const name = parsed.data.name;
  const normalizedName = normalizeGmailLabelName(name);
  const label = await prisma.gmailLabel.upsert({
    where: { mailboxId_normalizedName: { mailboxId: mailbox.id, normalizedName } },
    create: {
      mailboxId: mailbox.id,
      name,
      normalizedName,
      type: "USER",
      isMutable: true,
      state: "PENDING_CREATE",
    },
    update: { name, state: "PENDING_CREATE", lastErrorCode: null },
  });
  const operation = await createLabelOperation({
    mailboxId: mailbox.id,
    actorUserId,
    labelId: label.id,
    type: "CREATE",
    desiredPayload: { name },
    requestId: request.headers.get("Idempotency-Key") ?? `create:${name}`,
  });
  return json({ label, operation }, 202);
}

async function handleRenameLabel(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  labelId: string,
) {
  const parsed = renameLabelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  const mailbox = await requireProvisionedMailbox(tenantId, parsed.data.storeId, parsed.data.mailboxId);
  if (!mailbox) return errorJson("Forbidden — mailbox not found or inactive", 403);
  const label = await prisma.gmailLabel.findFirst({
    where: { id: labelId, mailboxId: mailbox.id, type: "USER", isMutable: true },
  });
  if (!label) return errorJson("Label not found", 404);

  await prisma.gmailLabel.update({
    where: { id: label.id },
    data: { name: parsed.data.name, normalizedName: normalizeGmailLabelName(parsed.data.name), state: "PENDING_RENAME" },
  });
  const operation = await createLabelOperation({
    mailboxId: mailbox.id,
    actorUserId,
    labelId: label.id,
    type: "RENAME",
    desiredPayload: { newName: parsed.data.name, labelName: label.name },
    requestId: request.headers.get("Idempotency-Key") ?? `rename:${label.id}:${parsed.data.name}`,
  });
  return json({ operation }, 202);
}

async function handleDeleteLabel(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  labelId: string,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox) return errorJson("Forbidden — mailbox not found or inactive", 403);
  const label = await prisma.gmailLabel.findFirst({
    where: { id: labelId, mailboxId: mailbox.id, type: "USER", isMutable: true },
    include: { conversations: true },
  });
  if (!label) return errorJson("Label not found", 404);

  await prisma.gmailLabel.update({ where: { id: label.id }, data: { state: "PENDING_DELETE" } });
  const operation = await createLabelOperation({
    mailboxId: mailbox.id,
    actorUserId,
    labelId: label.id,
    type: "DELETE",
    desiredPayload: { labelName: label.name, affectedConversationCount: label.conversations.length },
    requestId: request.headers.get("Idempotency-Key") ?? `delete:${label.id}`,
  });
  return json({ operation, affectedConversationCount: label.conversations.length }, 202);
}

async function handleListMailboxes(request: NextRequest, tenantId: string) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const store = await requireStoreAccess(tenantId, storeId);
  if (!store) return errorJson("Store not found", 404);

  const mailboxes = await prisma.mailbox.findMany({
    where: { tenantId, storeId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      syncStatus: true,
      rtQueueId: true,
    },
  });

  const unreadCounts = await Promise.all(
    mailboxes.map(async (mailbox) => [
      mailbox.id,
      await prisma.mailboxConversation.count({
        where: {
          mailboxId: mailbox.id,
          isUnread: true,
          labels: {
            some: {
              label: {
                type: "INBOX",
                state: "ACTIVE",
              },
            },
          },
        },
      }),
    ] as const),
  );
  const unreadCountByMailboxId = new Map(unreadCounts);

  return json({
    mailboxes: mailboxes.map((mailbox) => ({
      id: mailbox.id,
      name: mailbox.name,
      email: mailbox.email,
      active: mailbox.isActive,
      syncStatus: mailbox.syncStatus,
      provisioned: Boolean(mailbox.rtQueueId),
      unreadCount: unreadCountByMailboxId.get(mailbox.id) ?? 0,
    })),
    storeId,
  });
}

async function handleListConversations(request: NextRequest, tenantId: string) {
  const url = request.nextUrl;
  const storeId = extractStoreId(url.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(url.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;

  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox || !mailbox.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const status = url.searchParams.get("status") as AppStatus | null;
  const effectiveStatus =
    status && ["active", "pending", "closed"].includes(status) ? status : undefined;
  const labelId = url.searchParams.get("labelId");
  const selectedLabel = labelId ? mailbox.labels.find((label) => label.id === labelId) : undefined;
  if (labelId && !selectedLabel) return errorJson("Label not found", 404);

  if (selectedLabel) {
    const currentPage = pageNumber(url.searchParams.get("page"));
    const currentPageSize = pageSize(url.searchParams.get("pageSize"));
    const where = {
      mailboxId: mailbox.id,
      ...(effectiveStatus ? { status: effectiveStatus } : {}),
      labels: {
        some: {
          labelId: selectedLabel.id,
        },
      },
    };
    const [totalElements, conversationRows] = await Promise.all([
      prisma.mailboxConversation.count({ where }),
      prisma.mailboxConversation.findMany({
        where,
        select: {
          rtTicketId: true,
          lastActivityAt: true,
        },
        orderBy: [
          { lastActivityAt: "desc" },
          { updatedAt: "desc" },
        ],
        skip: (currentPage - 1) * currentPageSize,
        take: currentPageSize,
      }),
    ]);

    const normalizedLabels = mailbox.labels.map((label) => ({
      id: label.id,
      name: label.name,
      state: label.state,
    }));
    const ticketResults = await listTicketsByIds({
      queueId: mailbox.rtQueueId,
      ticketIds: conversationRows.map((conversation) => conversation.rtTicketId),
      mailboxId: mailbox.id,
      labels: normalizedLabels,
    });
    if (!ticketResults.ok || !ticketResults.data) {
      return errorJson("Mailbox upstream unavailable", 502);
    }

    const conversations = ticketResults.data;
    const senderSnapshots = await loadConversationSenderSnapshots(
      mailbox.id,
      conversations.map((conversation) => conversation.id),
    );
    return json({
      conversations: conversations.map((conversation) => {
        const snapshot = senderSnapshots.get(conversation.id);
        return {
          ...conversation,
          fromName: snapshot?.senderName ?? conversation.fromName,
          fromEmail: snapshot?.senderEmail ?? conversation.fromEmail,
          updatedAt: snapshot?.lastActivityAt?.toISOString() ?? conversation.updatedAt,
          unread: snapshot?.isUnread ?? false,
        };
      }),
      page: {
        size: currentPageSize,
        number: currentPage,
        totalElements,
        totalPages: Math.max(1, Math.ceil(totalElements / currentPageSize)),
      },
    });
  }

  const result = await searchTickets({
    queueId: mailbox.rtQueueId,
    mailboxId: mailbox.id,
    status: effectiveStatus,
    labels: mailbox.labels.map((label) => ({
      id: label.id,
      name: label.name,
      state: label.state,
    })),
    page: pageNumber(url.searchParams.get("page")),
    pageSize: pageSize(url.searchParams.get("pageSize")),
  });

  if (!result.ok || !result.data) return errorJson("Mailbox upstream unavailable", 502);
  const senderSnapshots = await loadConversationSenderSnapshots(
    mailbox.id,
    result.data.items.map((conversation) => conversation.id),
  );
  return json({
    conversations: result.data.items.map((conversation) => {
      const snapshot = senderSnapshots.get(conversation.id);
      return {
        ...conversation,
        fromName: snapshot?.senderName ?? conversation.fromName,
        fromEmail: snapshot?.senderEmail ?? conversation.fromEmail,
        updatedAt: snapshot?.lastActivityAt?.toISOString() ?? conversation.updatedAt,
        unread: snapshot?.isUnread ?? false,
      };
    }),
    page: {
      size: result.data.pageSize,
      number: result.data.page,
      totalElements: result.data.total,
      totalPages: result.data.pages,
    },
  });
}

async function handleGetConversation(
  request: NextRequest,
  tenantId: string,
  ticketId: number,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
  });
  if (!conversation) return errorJson("Conversation not found", 404);

  const [ticketResult, historyResult, attachmentResult] = await Promise.all([
    getTicket(ticketId),
    getTicketTransactions(ticketId),
    getTicketAttachmentDetails(ticketId),
  ]);
  if (!ticketResult.ok || !ticketResult.data || !historyResult.ok || !historyResult.data) {
    return errorJson("Mailbox upstream unavailable", 502);
  }
  const ticketQueueId = Number(
    typeof ticketResult.data.Queue === "object"
      ? ticketResult.data.Queue?.id
      : ticketResult.data.Queue,
  );
  if (ticketQueueId !== mailbox.rtQueueId) return errorJson("Conversation not found", 404);

  const displayThreads = enrichThreadsForDisplay({
    threads: historyResult.data.items,
    attachments: attachmentResult.ok && attachmentResult.data ? attachmentResult.data : [],
    mailboxEmail: mailbox.email,
    customerEmail: conversation.senderEmail,
    fallbackSubject: ticketResult.data.Subject ?? null,
  });

  const firstExternalThread =
    displayThreads.find((thread) => !thread.hidden && (thread.from || thread.sender))
    ?? displayThreads.find((thread) => !thread.hidden)
    ?? displayThreads[0];
  const sender = parseEmailIdentity(firstExternalThread?.from || firstExternalThread?.sender);
  if (
    (sender.name && sender.name !== conversation.senderName)
    || (sender.email && sender.email !== conversation.senderEmail)
  ) {
    await prisma.mailboxConversation.update({
      where: { id: conversation.id },
      data: {
        senderName: sender.name || conversation.senderName,
        senderEmail: sender.email || conversation.senderEmail,
      },
    });
  }

  return json({
    conversation: {
      ...normalizeRtTicket(
        ticketResult.data,
        mailbox.id,
        mailbox.labels.map((label) => ({
          id: label.id,
          name: label.name,
          state: label.state,
        })),
      ),
      fromName: sender.name || conversation.senderName || undefined,
      fromEmail: sender.email || conversation.senderEmail || undefined,
      unread: conversation.isUnread,
      updatedAt: conversation.lastActivityAt?.toISOString() ?? conversation.updatedAt.toISOString(),
    },
    gmailThreadId: conversation.gmailThreadId,
    threads: displayThreads,
  });
}

async function handleReply(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  ticketId: number,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const parsed = replySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
  });
  if (!conversation) return errorJson("Conversation not found", 404);

  const inboundMessageLinks = await prisma.gmailMessageLink.findMany({
    where: {
      mailboxId: mailbox.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      rfcMessageId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { rfcMessageId: true, createdAt: true },
  });

  const threads = await getTicketTransactions(ticketId);
  if (!threads.ok || !threads.data) return errorJson("Mailbox upstream unavailable", 502);

  const replyContext = buildGmailReplyContext({
    mailboxEmail: mailbox.email,
    ticketId,
    threads: threads.data.items,
    inboundMessageLinks,
  });
  if (!replyContext) {
    return errorJson("Conversation is missing Gmail reply headers", 409);
  }

  const credentials = {
    email: mailbox.email,
    appPassword: await getDecryptedAppPassword(mailbox.id),
  };
  const gmail = createGmailAdapter(credentials);
  const sent = await sendGmailThreadReply({
    credentials,
    to: replyContext.to,
    fromName: mailbox.email,
    subject: replyContext.subject,
    text: parsed.data.text,
    gmailThreadId: conversation.gmailThreadId,
    latestExternalMessageId: replyContext.latestExternalMessageId,
    references: replyContext.references,
    lookupByMessageId: gmail.lookupByMessageId,
  });

  await prisma.gmailMessageLink.create({
    data: {
      mailboxId: mailbox.id,
      conversationId: conversation.id,
      gmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.gmailThreadId,
      rfcMessageId: sent.rfcMessageId,
      imapUid: sent.uid,
      uidValidity: sent.uidValidity,
      rtTicketId: ticketId,
      direction: "OUTBOUND",
    },
  });

  await comment(ticketId, {
    content: [
      "App-sent Gmail reply recorded.",
      `Gmail-Message-ID: ${sent.rfcMessageId}`,
      `Gmail-Thread-ID: ${sent.gmailThreadId}`,
      "",
      parsed.data.text,
    ].join("\n"),
    contentType: "text/plain",
  });

  await logAudit({
    actorUserId,
    tenantId,
    action: "mailbox.reply",
    resourceType: "rt_ticket",
    resourceId: String(ticketId),
    metadata: { mailboxId: mailbox.id, storeId },
  });

  return json({ ok: true, gmailMessageId: sent.gmailMessageId, rfcMessageId: sent.rfcMessageId });
}

async function handleMarkConversationRead(
  request: NextRequest,
  tenantId: string,
  ticketId: number,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
    select: { gmailThreadId: true },
  });
  if (!conversation?.gmailThreadId) return errorJson("Conversation not found", 404);

  try {
    const appPassword = await getDecryptedAppPassword(mailbox.id);
    await createGmailAdapter({
      email: mailbox.email,
      appPassword,
    }).markThreadRead(conversation.gmailThreadId);

    await prisma.mailboxConversation.updateMany({
      where: { mailboxId: mailbox.id, rtTicketId: ticketId },
      data: { isUnread: false },
    });
  } catch (error) {
    console.error("[MailboxProxy] markThreadRead failed", {
      mailboxId: mailbox.id,
      ticketId,
      gmailThreadId: conversation.gmailThreadId,
      error,
    });
    return errorJson(error instanceof Error ? error.message : "mark_thread_read_failed", 502);
  }

  return json({ ok: true });
}

async function handleMarkConversationUnread(
  request: NextRequest,
  tenantId: string,
  ticketId: number,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
    select: { id: true, gmailThreadId: true },
  });
  if (!conversation?.gmailThreadId) return errorJson("Conversation not found", 404);

  try {
    const appPassword = await getDecryptedAppPassword(mailbox.id);
    await createGmailAdapter({
      email: mailbox.email,
      appPassword,
    }).markThreadUnread(conversation.gmailThreadId);

    await prisma.mailboxConversation.update({
      where: { id: conversation.id },
      data: { isUnread: true },
    });
  } catch (error) {
    console.error("[MailboxProxy] markThreadUnread failed", {
      mailboxId: mailbox.id,
      ticketId,
      gmailThreadId: conversation.gmailThreadId,
      error,
    });
    return errorJson(error instanceof Error ? error.message : "mark_thread_unread_failed", 502);
  }

  return json({ ok: true });
}

async function handleReportConversationSpam(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  ticketId: number,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
    select: { id: true, gmailThreadId: true, isUnread: true },
  });
  if (!conversation?.gmailThreadId) return errorJson("Conversation not found", 404);

  const appPassword = await getDecryptedAppPassword(mailbox.id);
  await createGmailAdapter({
    email: mailbox.email,
    appPassword,
  }).reportThreadSpam(conversation.gmailThreadId);

  await prisma.$transaction(async (tx) => {
    const inboxLabels = await tx.gmailLabel.findMany({
      where: {
        mailboxId: mailbox.id,
        type: "INBOX",
      },
      select: { id: true },
    });

    if (inboxLabels.length > 0) {
      await tx.conversationLabel.deleteMany({
        where: {
          conversationId: conversation.id,
          labelId: { in: inboxLabels.map((label) => label.id) },
        },
      });
    }

    await tx.mailboxConversation.update({
      where: { id: conversation.id },
      data: { isUnread: false },
    });
  });

  await logAudit({
    actorUserId,
    tenantId,
    action: "mailbox.report_spam",
    resourceType: "rt_ticket",
    resourceId: String(ticketId),
    metadata: { mailboxId: mailbox.id, storeId },
  });

  return json({ ok: true });
}

async function handleStatusUpdate(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  ticketId: number,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
  });
  if (!conversation) return errorJson("Conversation not found", 404);

  const result = await updateTicketStatus(ticketId, parsed.data.status);
  if (!result.ok) return errorJson("Mailbox upstream unavailable", 502);

  await prisma.mailboxConversation.update({
    where: { id: conversation.id },
    data: { status: parsed.data.status },
  });

  await logAudit({
    actorUserId,
    tenantId,
    action: "mailbox.status_update",
    resourceType: "rt_ticket",
    resourceId: String(ticketId),
    metadata: { mailboxId: mailbox.id, storeId, status: parsed.data.status },
  });

  return json({ ok: true });
}

async function handleReplaceConversationLabels(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  ticketId: number,
) {
  const body = await request.json().catch(() => null);
  const parsed = replaceConversationLabelsSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const mailbox = await requireProvisionedMailbox(tenantId, parsed.data.storeId, parsed.data.mailboxId);
  if (!mailbox) return errorJson("Forbidden — mailbox not found or inactive", 403);
  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
    include: { labels: true },
  });
  if (!conversation) return errorJson("Conversation not found", 404);

  const requested = await prisma.gmailLabel.findMany({
    where: {
      mailboxId: mailbox.id,
      id: { in: parsed.data.labelIds },
      state: "ACTIVE",
      type: "USER",
    },
  });
  if (requested.length !== new Set(parsed.data.labelIds).size) {
    return errorJson("One or more labels do not belong to this mailbox", 422);
  }

  const currentIds = new Set(conversation.labels.map((join) => join.labelId));
  const desiredIds = new Set(requested.map((label) => label.id));
  const operations = [];

  for (const label of requested) {
    if (currentIds.has(label.id)) continue;
    operations.push(await createLabelOperation({
      mailboxId: mailbox.id,
      actorUserId,
      conversationId: conversation.id,
      labelId: label.id,
      type: "ASSIGN",
      desiredPayload: { labelName: label.name, labelIds: parsed.data.labelIds },
      requestId: request.headers.get("Idempotency-Key") ?? `assign:${conversation.id}:${label.id}`,
    }));
  }

  for (const labelId of currentIds) {
    if (desiredIds.has(labelId)) continue;
    const label = mailbox.labels.find((candidate) => candidate.id === labelId);
    if (!label || label.type !== "USER") continue;
    operations.push(await createLabelOperation({
      mailboxId: mailbox.id,
      actorUserId,
      conversationId: conversation.id,
      labelId: label.id,
      type: "UNASSIGN",
      desiredPayload: { labelName: label.name, labelIds: parsed.data.labelIds },
      requestId: request.headers.get("Idempotency-Key") ?? `unassign:${conversation.id}:${label.id}`,
    }));
  }

  return json({ operations, state: operations.length ? "PENDING" : "SUCCEEDED" }, operations.length ? 202 : 200);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
