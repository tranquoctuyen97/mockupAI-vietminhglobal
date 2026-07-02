import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getDecryptedAppPassword } from "@/lib/mailboxes/credentials";
import { normalizeMailboxConversationListRow } from "@/lib/mailboxes/conversation-list-snapshot";
import { createLabelOperation, normalizeGmailLabelName } from "@/lib/mailboxes/labels";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";
import { parseEmailIdentity } from "@/lib/mailboxes/identity";
import { sendGmailThreadReply } from "@/lib/mailboxes/gmail-reply";
import { buildGmailReplyContext } from "@/lib/mailboxes/reply-context";
import { buildMonthlyResponseSummary, mailboxResponseMetrics } from "@/lib/mailboxes/response-metrics";
import {
  createLabelSchema,
  internalNoteSchema,
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
  updateTicketStatus,
} from "@/lib/rt/client";
import { provisionMailbox } from "@/lib/rt/provisioning";
import { normalizeRtTicket } from "@/lib/rt/normalizers";
import { enrichThreadsForDisplay } from "@/lib/rt/thread-display";
import type { AppStatus } from "@/lib/rt/types";
import { getStorage } from "@/lib/storage/local-disk";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parsePath(segments: string[]): string {
  return `/${segments.join("/")}`;
}

type ConversationToken = { raw: string; rtTicketId?: number; conversationId?: string };

function parseConversationToken(raw: string): ConversationToken | null {
  if (raw.startsWith("gmail:")) {
    const conversationId = raw.slice("gmail:".length);
    return conversationId ? { raw, conversationId } : null;
  }
  const rtTicketId = Number(raw);
  return Number.isSafeInteger(rtTicketId) && rtTicketId > 0 ? { raw, rtTicketId } : null;
}

function conversationWhere(mailboxId: string, token: ConversationToken) {
  return token.rtTicketId
    ? { mailboxId, rtTicketId: token.rtTicketId }
    : { mailboxId, id: token.conversationId };
}

async function resolveGmailConversation(
  request: NextRequest,
  tenantId: string,
  conversationToken: string,
) {
  const token = parseConversationToken(conversationToken);
  if (!token) return errorJson("Conversation not found", 404);
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const conversation = await prisma.mailboxConversation.findFirst({
    where: conversationWhere(mailbox.id, token),
    select: { id: true, gmailThreadId: true, isUnread: true, rtTicketId: true, senderEmail: true },
  });
  if (!conversation?.gmailThreadId) return errorJson("Conversation not found", 404);
  return { storeId, mailbox, conversation };
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

function monthRange(value: string | null) {
  const month = value && /^\d{4}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { month, from, to };
}

function serializeOverdueResponseMetric(metric: {
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
}) {
  return {
    id: metric.conversation?.rtTicketId ?? null,
    subject: metric.conversation?.subject ?? null,
    fromName: metric.conversation?.senderName ?? null,
    fromEmail: metric.conversation?.senderEmail ?? null,
    responseStartedAt: metric.responseStartedAt.toISOString(),
    latestAdminReplyAt: metric.latestAdminReplyAt?.toISOString() ?? null,
    latestAdminReplyActorUserId: metric.latestAdminReplyActorUserId ?? null,
    responseDurationMs: metric.responseDurationMs?.toString() ?? null,
  };
}

function safeAttachmentFilename(value: string) {
  return value.replace(/[^\w.\- ()]/g, "_").slice(0, 180) || "attachment";
}

function composerAttachmentStoragePath(input: {
  tenantId: string;
  mailboxId: string;
  conversationId: string;
  attachmentId: string;
  filename: string;
}) {
  return [
    "mailboxes",
    input.tenantId,
    input.mailboxId,
    input.conversationId,
    "composer-attachments",
    `${input.attachmentId}-${safeAttachmentFilename(input.filename)}`,
  ].join("/");
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
  if (method === "GET" && proxyPath === "/response-metrics/summary") {
    return handleResponseMetricSummary(request, session.tenantId);
  }
  if (method === "GET" && proxyPath === "/response-metrics/overdue") {
    return handleOverdueResponseMetrics(request, session.tenantId);
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

  const detailMatch = proxyPath.match(/^\/conversations\/([^/]+)$/);
  if (method === "GET" && detailMatch) {
    return handleGetConversation(request, session.tenantId, detailMatch[1]);
  }
  if (method === "PUT" && detailMatch && /^\d+$/.test(detailMatch[1])) {
    return handleStatusUpdate(request, session.tenantId, session.id, Number(detailMatch[1]));
  }

  const readMatch = proxyPath.match(/^\/conversations\/([^/]+)\/read$/);
  if (method === "POST" && readMatch) {
    return handleMarkConversationRead(request, session.tenantId, readMatch[1]);
  }

  const unreadMatch = proxyPath.match(/^\/conversations\/([^/]+)\/unread$/);
  if (method === "POST" && unreadMatch) {
    return handleMarkConversationUnread(request, session.tenantId, unreadMatch[1]);
  }

  const spamMatch = proxyPath.match(/^\/conversations\/([^/]+)\/report-spam$/);
  if (method === "POST" && spamMatch) {
    return handleReportConversationSpam(request, session.tenantId, session.id, spamMatch[1]);
  }

  const deleteMatch = proxyPath.match(/^\/conversations\/([^/]+)\/delete$/);
  if (method === "POST" && deleteMatch) {
    return handleDeleteConversation(request, session.tenantId, session.id, deleteMatch[1]);
  }

  const skipSenderMatch = proxyPath.match(/^\/conversations\/([^/]+)\/skip-sender$/);
  if (method === "POST" && skipSenderMatch) {
    return handleSkipSender(request, session.tenantId, session.id, skipSenderMatch[1]);
  }

  const replyMatch = proxyPath.match(/^\/conversations\/(\d+)\/threads$/);
  if (method === "POST" && replyMatch) {
    return handleReply(request, session.tenantId, session.id, Number(replyMatch[1]));
  }

  const internalNoteMatch = proxyPath.match(/^\/conversations\/(\d+)\/internal-notes$/);
  if (method === "POST" && internalNoteMatch) {
    return handleCreateInternalNote(request, session.tenantId, session.id, Number(internalNoteMatch[1]));
  }

  const attachmentMatch = proxyPath.match(/^\/conversations\/(\d+)\/attachments$/);
  if (method === "POST" && attachmentMatch) {
    return handleUploadComposerAttachment(request, session.tenantId, session.id, Number(attachmentMatch[1]));
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

async function handleResponseMetricSummary(request: NextRequest, tenantId: string) {
  const storeId = request.nextUrl.searchParams.get("storeId") ?? undefined;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") ?? undefined;
  const { month, from, to } = monthRange(request.nextUrl.searchParams.get("month"));
  if (storeId && !await requireStoreAccess(tenantId, storeId)) {
    return errorJson("Forbidden — store not found", 403);
  }
  if (storeId && mailboxId && !await requireMailbox(tenantId, storeId, mailboxId)) {
    return errorJson("Forbidden — mailbox not found or inactive", 403);
  }
  const metrics = await mailboxResponseMetrics.listForSummary({ tenantId, storeId, mailboxId, from, to });
  return json({ month, summary: buildMonthlyResponseSummary(metrics) });
}

async function handleOverdueResponseMetrics(request: NextRequest, tenantId: string) {
  const storeId = request.nextUrl.searchParams.get("storeId") ?? undefined;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") ?? undefined;
  if (storeId && !await requireStoreAccess(tenantId, storeId)) {
    return errorJson("Forbidden — store not found", 403);
  }
  if (storeId && mailboxId && !await requireMailbox(tenantId, storeId, mailboxId)) {
    return errorJson("Forbidden — mailbox not found or inactive", 403);
  }
  const metrics = await mailboxResponseMetrics.listOverdue({
    tenantId,
    storeId,
    mailboxId,
    now: new Date(),
    thresholdMs: 24 * 60 * 60 * 1000,
  });
  return json({ conversations: metrics.map((metric) => serializeOverdueResponseMetric(metric)) });
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

  const currentPage = pageNumber(url.searchParams.get("page"));
  const currentPageSize = pageSize(url.searchParams.get("pageSize"));
  const where = mailboxConversationWhere({
    mailboxId: mailbox.id,
    status: effectiveStatus,
    labelId: selectedLabel?.id ?? null,
  });
  const [totalElements, conversationRows] = await Promise.all([
    prisma.mailboxConversation.count({ where }),
    prisma.mailboxConversation.findMany({
      where,
      include: {
        labels: { include: { label: true } },
        responseMetric: {
          select: {
            responseStartedAt: true,
            latestAdminReplyAt: true,
            responseDurationMs: true,
          },
        },
        internalNotes: {
          orderBy: { createdAt: "desc" },
          select: { id: true, body: true, createdAt: true },
        },
      },
      orderBy: [
        { lastActivityAt: "desc" },
        { rtLastUpdatedAt: "desc" },
        { updatedAt: "desc" },
      ],
      skip: (currentPage - 1) * currentPageSize,
      take: currentPageSize,
    }),
  ]);

  return json({
    conversations: conversationRows.map(normalizeMailboxConversationListRow),
    page: {
      size: currentPageSize,
      number: currentPage,
      totalElements,
      totalPages: Math.max(1, Math.ceil(totalElements / currentPageSize)),
    },
  });
}

async function handleGetConversation(
  request: NextRequest,
  tenantId: string,
  conversationToken: string,
) {
  const token = parseConversationToken(conversationToken);
  if (!token) return errorJson("Conversation not found", 404);
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(request.nextUrl.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;
  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox?.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const conversation = await prisma.mailboxConversation.findFirst({
    where: conversationWhere(mailbox.id, token),
    include: { labels: { include: { label: true } } },
  });
  if (!conversation) return errorJson("Conversation not found", 404);
  if (conversation.rtTicketId == null) {
    const [messageLinks, internalNotes] = await Promise.all([
      prisma.gmailMessageLink.findMany({
        where: { mailboxId: mailbox.id, conversationId: conversation.id },
        orderBy: { gmailInternalDate: "asc" },
        select: { id: true, rfcMessageId: true, direction: true, gmailInternalDate: true },
      }),
      prisma.mailboxInternalNote.findMany({
        where: { mailboxId: mailbox.id, conversationId: conversation.id },
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { email: true } } },
      }),
    ]);
    const id = `gmail:${conversation.id}`;
    const threads = [
      ...messageLinks.map((link) => ({
        id: `gmail-${link.id}`,
        conversationId: id,
        subject: conversation.subject ?? undefined,
        body: link.rfcMessageId ? `Message-ID: ${link.rfcMessageId}` : conversation.subject ?? "",
        contentType: "text/plain",
        from: link.direction === "INBOUND" ? conversation.senderEmail ?? undefined : mailbox.email,
        to: link.direction === "INBOUND" ? mailbox.email : conversation.senderEmail ?? undefined,
        cc: "",
        type: link.direction === "INBOUND" ? "email" : "app_reply",
        sender: link.direction === "INBOUND" ? conversation.senderEmail ?? undefined : mailbox.email,
        internal: false,
        hidden: false,
        displayType: link.direction === "INBOUND" ? "email" as const : "app_reply" as const,
        attachments: [],
        createdAt: (link.gmailInternalDate ?? conversation.createdAt).toISOString(),
      })),
      ...internalNotes.map((note) => ({
        id: `note-${note.id}`,
        conversationId: id,
        subject: "Internal note",
        body: note.body,
        contentType: "text/plain",
        from: note.actor.email,
        to: mailbox.email,
        cc: "",
        type: "comment",
        sender: note.actor.email,
        internal: true,
        hidden: false,
        displayType: "internal" as const,
        attachments: [],
        createdAt: note.createdAt.toISOString(),
      })),
    ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    return json({
      conversation: normalizeMailboxConversationListRow(conversation),
      gmailThreadId: conversation.gmailThreadId,
      threads,
    });
  }
  const ticketId = conversation.rtTicketId;

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
  const internalNotes = await prisma.mailboxInternalNote.findMany({
    where: { mailboxId: mailbox.id, conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { email: true } } },
  });
  const internalThreads = internalNotes.map((note) => ({
    id: `note-${note.id}`,
    conversationId: ticketId,
    subject: "Internal note",
    body: note.body,
    contentType: "text/plain",
    from: note.actor.email,
    to: mailbox.email,
    cc: "",
    type: "comment",
    sender: note.actor.email,
    internal: true,
    hidden: false,
    displayType: "internal" as const,
    attachments: [],
    createdAt: note.createdAt.toISOString(),
  }));
  const mergedThreads = [...displayThreads, ...internalThreads].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

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
    threads: mergedThreads,
  });
}

async function handleCreateInternalNote(
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

  const parsed = internalNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const conversation = await prisma.mailboxConversation.findFirst({
    where: { mailboxId: mailbox.id, rtTicketId: ticketId },
  });
  if (!conversation) return errorJson("Conversation not found", 404);

  const note = await prisma.mailboxInternalNote.create({
    data: {
      mailboxId: mailbox.id,
      conversationId: conversation.id,
      actorUserId,
      body: parsed.data.text,
    },
    include: { actor: { select: { email: true } } },
  });

  await logAudit({
    actorUserId,
    tenantId,
    action: "mailbox.internal_note",
    resourceType: "rt_ticket",
    resourceId: String(ticketId),
    metadata: { mailboxId: mailbox.id, storeId },
  });

  return json({
    note: {
      id: `note-${note.id}`,
      conversationId: ticketId,
      subject: "Internal note",
      body: note.body,
      contentType: "text/plain",
      from: note.actor.email,
      to: mailbox.email,
      cc: "",
      type: "comment",
      sender: note.actor.email,
      internal: true,
      hidden: false,
      displayType: "internal",
      attachments: [],
      createdAt: note.createdAt.toISOString(),
    },
  }, 201);
}

async function handleUploadComposerAttachment(
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
  });
  if (!conversation) return errorJson("Conversation not found", 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorJson("file is required", 422);
  if (file.size <= 0) return errorJson("file is empty", 422);
  if (file.size > 15 * 1024 * 1024) return errorJson("Attachment must be 15MB or smaller", 413);

  const attachment = await prisma.mailboxComposerAttachment.create({
    data: {
      mailboxId: mailbox.id,
      conversationId: conversation.id,
      uploadedById: actorUserId,
      filename: safeAttachmentFilename(file.name || "attachment"),
      contentType: file.type || "application/octet-stream",
      byteSize: file.size,
      storagePath: "pending",
    },
  });
  const storagePath = composerAttachmentStoragePath({
    tenantId,
    mailboxId: mailbox.id,
    conversationId: conversation.id,
    attachmentId: attachment.id,
    filename: attachment.filename,
  });
  await getStorage().putBuffer(storagePath, Buffer.from(await file.arrayBuffer()), attachment.contentType);
  const saved = await prisma.mailboxComposerAttachment.update({
    where: { id: attachment.id },
    data: { storagePath },
  });

  return json({
    attachment: {
      id: saved.id,
      filename: saved.filename,
      contentType: saved.contentType,
      byteSize: saved.byteSize,
    },
  }, 201);
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
    fallbackCustomerEmail: conversation.senderEmail,
    fallbackSubject: conversation.subject,
  });
  if (!replyContext) {
    return errorJson("Conversation is missing Gmail reply headers", 409);
  }

  const credentials = {
    email: mailbox.email,
    appPassword: await getDecryptedAppPassword(mailbox.id),
  };
  const gmail = createGmailAdapter(credentials);
  const composerAttachments = parsed.data.attachmentIds?.length
    ? await prisma.mailboxComposerAttachment.findMany({
        where: {
          id: { in: parsed.data.attachmentIds },
          mailboxId: mailbox.id,
          conversationId: conversation.id,
          uploadedById: actorUserId,
          state: "READY",
        },
      })
    : [];
  if ((parsed.data.attachmentIds?.length ?? 0) !== composerAttachments.length) {
    return errorJson("One or more attachments are not available", 422);
  }
  const attachmentPayload = await Promise.all(
    composerAttachments.map(async (attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: await getStorage().getBuffer(attachment.storagePath),
    })),
  );
  const sent = await sendGmailThreadReply({
    credentials,
    to: replyContext.to,
    fromName: mailbox.email,
    subject: replyContext.subject,
    text: parsed.data.text,
    attachments: attachmentPayload.length ? attachmentPayload : undefined,
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
      gmailInternalDate: sent.internalDate,
    },
  });
  if (composerAttachments.length > 0) {
    await prisma.mailboxComposerAttachment.updateMany({
      where: { id: { in: composerAttachments.map((attachment) => attachment.id) } },
      data: {
        state: "SENT",
        gmailMessageId: sent.gmailMessageId,
      },
    });
  }

  const repliedAt = sent.internalDate;
  await mailboxResponseMetrics.recordAdminReply({
    conversationId: conversation.id,
    actorUserId,
    repliedAt,
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

  await prisma.mailboxConversation.update({
    where: { id: conversation.id },
    data: {
      articleCount: { increment: 1 },
      rtLastUpdatedAt: repliedAt,
      lastActivityAt: repliedAt,
    },
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
  conversationToken: string,
) {
  const resolved = await resolveGmailConversation(request, tenantId, conversationToken);
  if (resolved instanceof NextResponse) return resolved;
  const { mailbox, conversation } = resolved;

  try {
    const appPassword = await getDecryptedAppPassword(mailbox.id);
    await createGmailAdapter({
      email: mailbox.email,
      appPassword,
    }).markThreadRead(conversation.gmailThreadId);

    await prisma.mailboxConversation.updateMany({
      where: { id: conversation.id },
      data: { isUnread: false },
    });
  } catch (error) {
    console.error("[MailboxProxy] markThreadRead failed", {
      mailboxId: mailbox.id,
      ticketId: conversation.rtTicketId,
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
  conversationToken: string,
) {
  const resolved = await resolveGmailConversation(request, tenantId, conversationToken);
  if (resolved instanceof NextResponse) return resolved;
  const { mailbox, conversation } = resolved;

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
      ticketId: conversation.rtTicketId,
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
  conversationToken: string,
) {
  const resolved = await resolveGmailConversation(request, tenantId, conversationToken);
  if (resolved instanceof NextResponse) return resolved;
  const { storeId, mailbox, conversation } = resolved;

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
    resourceId: String(conversation.rtTicketId ?? conversation.id),
    metadata: { mailboxId: mailbox.id, storeId },
  });

  return json({ ok: true });
}

async function handleDeleteConversation(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  conversationToken: string,
) {
  const resolved = await resolveGmailConversation(request, tenantId, conversationToken);
  if (resolved instanceof NextResponse) return resolved;
  const { storeId, mailbox, conversation } = resolved;

  const appPassword = await getDecryptedAppPassword(mailbox.id);
  await createGmailAdapter({
    email: mailbox.email,
    appPassword,
  }).moveThreadToTrash(conversation.gmailThreadId);

  await prisma.$transaction(async (tx) => {
    const sourceLabels = await tx.gmailLabel.findMany({
      where: {
        mailboxId: mailbox.id,
        OR: [
          { type: "INBOX" },
          { name: { in: ["SPAM", "\\Spam", "[Gmail]/Spam"] } },
        ],
      },
      select: { id: true },
    });

    if (sourceLabels.length > 0) {
      await tx.conversationLabel.deleteMany({
        where: {
          conversationId: conversation.id,
          labelId: { in: sourceLabels.map((label) => label.id) },
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
    action: "mailbox.delete",
    resourceType: "rt_ticket",
    resourceId: String(conversation.rtTicketId ?? conversation.id),
    metadata: {
      mailboxId: mailbox.id,
      storeId,
      gmailThreadId: conversation.gmailThreadId,
      action: "move_to_trash",
    },
  });

  return json({ ok: true });
}

async function handleSkipSender(
  request: NextRequest,
  tenantId: string,
  actorUserId: string,
  conversationToken: string,
) {
  const resolved = await resolveGmailConversation(request, tenantId, conversationToken);
  if (resolved instanceof NextResponse) return resolved;
  const { storeId, mailbox, conversation } = resolved;
  const senderEmail = conversation.senderEmail?.trim().toLowerCase();
  if (!senderEmail || !senderEmail.includes("@")) return errorJson("Conversation sender email is missing", 422);
  if (senderEmail === mailbox.email.trim().toLowerCase()) return errorJson("Cannot skip the mailbox sender", 422);

  const appPassword = await getDecryptedAppPassword(mailbox.id);
  await createGmailAdapter({
    email: mailbox.email,
    appPassword,
  }).reportThreadSpam(conversation.gmailThreadId);

  await prisma.$transaction(async (tx) => {
    await tx.mailboxSkippedSender.upsert({
      where: {
        mailboxId_senderEmail: {
          mailboxId: mailbox.id,
          senderEmail,
        },
      },
      create: {
        mailboxId: mailbox.id,
        senderEmail,
        createdById: actorUserId,
      },
      update: {},
    });

    const inboxLabels = await tx.gmailLabel.findMany({
      where: { mailboxId: mailbox.id, type: "INBOX" },
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
    action: "mailbox.skip_sender",
    resourceType: "rt_ticket",
    resourceId: String(conversation.rtTicketId ?? conversation.id),
    metadata: {
      mailboxId: mailbox.id,
      storeId,
      senderEmail,
    },
  });

  return json({ ok: true, senderEmail });
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
    data: {
      status: parsed.data.status,
      rtStatus: parsed.data.status,
      rtLastUpdatedAt: new Date(),
    },
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
