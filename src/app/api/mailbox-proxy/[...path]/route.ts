/**
 * Mailbox Proxy — REST API proxy to self-hosted Zammad.
 *
 * Security:
 * - Requires authenticated session + hasFeature("mailboxes")
 * - Allowlists routes and methods (rejects everything else with 403)
 * - Does NOT forward client headers — builds clean outbound headers
 * - Uses a single server-only ZAMMAD_ADMIN_TOKEN
 * - Sanitizes query params for list endpoints
 * - Validates and shapes request bodies for write endpoints
 * - Enforces UserMailboxAccess for ADMIN/OPERATOR
 * - SUPER_ADMIN bypasses mailbox access but still needs ZammadUser for writes
 * - Redacts API tokens from all logs
 * - 10-second timeout on upstream requests
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  getMailboxAuthContext,
  getAllowedMailboxIds,
  getMailboxAccess,
  requireZammadUser,
} from "@/lib/zammad/auth";
import {
  listGroups,
  searchTickets,
  getTicket,
  getTicketArticles,
  createTicketArticle,
  updateTicketState,
} from "@/lib/zammad/client";
import { validateReplyBody, validateStatusBody } from "@/lib/zammad/validation";
import type { AppStatus } from "@/lib/zammad/types";

// ──────────────────────────── Helpers ────────────────────────────

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Parse [...path] segments from the catch-all route.
 */
function parsePath(segments: string[]): string {
  return `/${segments.join("/")}`;
}

// ──────────────────────────── Route handler ────────────────────────────

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  // 1. Auth + feature gate
  const guard = await requireFeature("mailboxes");
  if (guard.response) return guard.response;
  const { session } = guard;

  // 2. Build mailbox auth context
  const ctx = await getMailboxAuthContext(session);

  // 3. Parse the proxied path
  const { path: pathSegments } = await params;
  if (!pathSegments || pathSegments.length === 0) {
    return errorJson("Invalid proxy path", 400);
  }
  const proxyPath = parsePath(pathSegments);
  const method = request.method as "GET" | "POST" | "PUT";

  // 4. Route to the correct handler
  // GET /mailboxes
  if (method === "GET" && proxyPath === "/mailboxes") {
    return handleListMailboxes(ctx);
  }

  // GET /conversations (list)
  if (method === "GET" && proxyPath === "/conversations") {
    return handleListConversations(request, ctx);
  }

  // GET /conversations/:id (detail)
  const convDetailMatch = proxyPath.match(/^\/conversations\/(\d+)$/);
  if (method === "GET" && convDetailMatch) {
    return handleGetConversation(Number(convDetailMatch[1]), ctx);
  }

  // POST /conversations/:id/threads (reply)
  const replyMatch = proxyPath.match(/^\/conversations\/(\d+)\/threads$/);
  if (method === "POST" && replyMatch) {
    return handleReply(request, Number(replyMatch[1]), ctx);
  }

  // PUT /conversations/:id (status update)
  const statusMatch = proxyPath.match(/^\/conversations\/(\d+)$/);
  if (method === "PUT" && statusMatch) {
    return handleStatusUpdate(request, Number(statusMatch[1]), ctx);
  }

  // Everything else — reject
  await logAuditEntry(ctx, "mailbox.proxy_rejected", "denied", {
    path: proxyPath,
    method,
  });
  return errorJson("Forbidden — unsupported proxy route", 403);
}

// ──────────────────────────── Active check helper ────────────────────────

/**
 * Enforce Mailbox.isActive on all proxy operations.
 * Returns error response if the mailbox is disabled or unmanaged.
 */
async function requireActiveMailbox(zammadGroupId: number): Promise<NextResponse | null> {
  const mailbox = await prisma.mailbox.findUnique({
    where: { zammadGroupId },
    select: { isActive: true },
  });
  // If mailbox is not app-managed or is disabled, deny access
  if (!mailbox || !mailbox.isActive) {
    return errorJson("Mailbox is disabled or not found", 403);
  }
  return null;
}

// ──────────────────────────── GET /mailboxes ────────────────────────────

async function handleListMailboxes(ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>) {
  // Use app-managed Mailbox records, not all Zammad groups
  let appMailboxes = await prisma.mailbox.findMany({
    where: { isActive: true },
    select: { zammadGroupId: true, name: true, email: true },
  });

  // Filter by UserMailboxAccess for non-SUPER_ADMIN
  if (!ctx.isSuperAdmin) {
    const allowedIds = await getAllowedMailboxIds(ctx);
    if (allowedIds) {
      appMailboxes = appMailboxes.filter((m) => allowedIds.includes(m.zammadGroupId));
    }
  }

  return json({
    mailboxes: appMailboxes.map((m) => ({
      id: m.zammadGroupId,
      name: m.name,
      active: true,
    })),
  });
}

// ──────────────────────────── GET /conversations ────────────────────────────

async function handleListConversations(
  request: NextRequest,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  const url = request.nextUrl;

  // Sanitize query params — only allow mailboxId, status, page, pageSize
  const mailboxIdRaw = url.searchParams.get("mailboxId");
  if (!mailboxIdRaw || !/^\d+$/.test(mailboxIdRaw)) {
    return errorJson("mailboxId is required and must be a positive integer", 422);
  }
  const mailboxId = Number(mailboxIdRaw);

  // Enforce isActive — disabled mailboxes cannot list conversations
  const activeCheck = await requireActiveMailbox(mailboxId);
  if (activeCheck) return activeCheck;

  // Check mailbox access
  const access = await getMailboxAccess(ctx, mailboxId);
  if (!access) {
    await logAuditEntry(ctx, "mailbox.conversation_list_denied", "denied", {
      mailboxId,
    });
    return errorJson("Forbidden — no access to this mailbox", 403);
  }

  // Parse and validate optional params
  const status = url.searchParams.get("status") as AppStatus | null;
  const validStatuses: AppStatus[] = ["active", "pending", "closed"];
  const effectiveStatus = status && validStatuses.includes(status) ? status : undefined;

  const pageRaw = url.searchParams.get("page");
  const page = pageRaw && /^\d+$/.test(pageRaw) && Number(pageRaw) > 0
    ? Number(pageRaw) : 1;

  const pageSizeRaw = url.searchParams.get("pageSize");
  const pageSize = pageSizeRaw && /^\d+$/.test(pageSizeRaw)
    ? Math.min(Number(pageSizeRaw), 100) : 25;

  const result = await searchTickets({
    groupId: mailboxId,
    status: effectiveStatus,
    page,
    pageSize,
  });

  if (!result.ok) return handleUpstreamError(result.status);

  return json({
    conversations: result.data ?? [],
    // Zammad search doesn't return pagination metadata the same way,
    // but we still provide page info for the UI
    page: {
      size: pageSize,
      number: page,
      // Zammad doesn't return totalElements/totalPages in search,
      // so we infer from result count
      totalElements: (result.data?.length ?? 0) < pageSize
        ? (page - 1) * pageSize + (result.data?.length ?? 0)
        : -1, // unknown total
      totalPages: (result.data?.length ?? 0) < pageSize ? page : page + 1,
    },
  });
}

// ──────────────────────────── GET /conversations/:id ────────────────────────────

async function handleGetConversation(
  conversationId: number,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  // Fetch ticket
  const ticketResult = await getTicket(conversationId);

  if (!ticketResult.ok) {
    if (ticketResult.status === 404) {
      return errorJson("Email này không còn tồn tại hoặc đã bị xóa.", 404);
    }
    return handleUpstreamError(ticketResult.status);
  }

  const conversation = ticketResult.data!;

  // Enforce isActive
  const activeCheck = await requireActiveMailbox(conversation.mailboxId);
  if (activeCheck) return activeCheck;

  // Check mailbox access for the returned ticket's group
  const access = await getMailboxAccess(ctx, conversation.mailboxId);
  if (!access) {
    await logAuditEntry(ctx, "mailbox.conversation_read_denied", "denied", {
      conversationId,
      mailboxId: conversation.mailboxId,
    });
    return errorJson("Forbidden — no access to this mailbox", 403);
  }

  // Fetch articles (Zammad requires separate call — ticket + articles)
  const articlesResult = await getTicketArticles(conversationId);
  const threads = articlesResult.ok ? (articlesResult.data ?? []) : [];

  return json({
    conversation,
    threads,
  });
}

// ──────────────────────────── POST /conversations/:id/threads ────────────────────────────

async function handleReply(
  request: NextRequest,
  conversationId: number,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  // Require ZammadUser mapping
  if (!requireZammadUser(ctx)) {
    return errorJson("Tài khoản email của bạn chưa được cấu hình. Vui lòng liên hệ SUPER_ADMIN.", 404);
  }

  // Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const validation = validateReplyBody(body);
  if (!validation.valid) {
    return errorJson(validation.error, 422);
  }

  // Fetch ticket to verify mailbox access
  const ticketResult = await getTicket(conversationId);

  if (!ticketResult.ok) {
    if (ticketResult.status === 404) {
      return errorJson("Email này không còn tồn tại hoặc đã bị xóa.", 404);
    }
    return handleUpstreamError(ticketResult.status);
  }

  const conversation = ticketResult.data!;

  // Enforce isActive
  const activeCheck = await requireActiveMailbox(conversation.mailboxId);
  if (activeCheck) return activeCheck;

  const access = await getMailboxAccess(ctx, conversation.mailboxId);
  if (!access) {
    await logAuditEntry(ctx, "mailbox.reply_denied", "denied", {
      conversationId,
      mailboxId: conversation.mailboxId,
      reason: "no_mailbox_access",
    });
    return errorJson("Forbidden — no access to this mailbox", 403);
  }

  if (!ctx.isSuperAdmin && !access.canReply) {
    await logAuditEntry(ctx, "mailbox.reply_denied", "denied", {
      conversationId,
      mailboxId: conversation.mailboxId,
      reason: "canReply_false",
    });
    return errorJson("Forbidden — you do not have reply permission for this mailbox", 403);
  }

  // Create article on Zammad
  const result = await createTicketArticle(conversationId, validation.text);

  if (!result.ok) {
    if (result.status === 404) {
      return errorJson("Email này không còn tồn tại hoặc đã bị xóa.", 404);
    }
    if (result.status === 409) {
      return errorJson("Conflict — conversation may have been modified", 409);
    }
    if (result.status === 422) {
      return errorJson("Validation error from email system", 422);
    }
    return handleUpstreamError(result.status);
  }

  await logAuditEntry(ctx, "mailbox.reply_sent", "success", {
    conversationId,
    mailboxId: conversation.mailboxId,
  });

  return json({ success: true }, 201);
}

// ──────────────────────────── PUT /conversations/:id ────────────────────────────

async function handleStatusUpdate(
  request: NextRequest,
  conversationId: number,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  // Require ZammadUser mapping
  if (!requireZammadUser(ctx)) {
    return errorJson("Tài khoản email của bạn chưa được cấu hình. Vui lòng liên hệ SUPER_ADMIN.", 404);
  }

  // Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const validation = validateStatusBody(body);
  if (!validation.valid) {
    return errorJson(validation.error, 422);
  }

  // Fetch ticket to verify mailbox access
  const ticketResult = await getTicket(conversationId);

  if (!ticketResult.ok) {
    if (ticketResult.status === 404) {
      return errorJson("Email này không còn tồn tại hoặc đã bị xóa.", 404);
    }
    return handleUpstreamError(ticketResult.status);
  }

  const conversation = ticketResult.data!;

  // Enforce isActive
  const activeCheck = await requireActiveMailbox(conversation.mailboxId);
  if (activeCheck) return activeCheck;

  const access = await getMailboxAccess(ctx, conversation.mailboxId);
  if (!access) {
    await logAuditEntry(ctx, "mailbox.status_denied", "denied", {
      conversationId,
      mailboxId: conversation.mailboxId,
      reason: "no_mailbox_access",
    });
    return errorJson("Forbidden — no access to this mailbox", 403);
  }

  if (!ctx.isSuperAdmin && !access.canUpdateStatus) {
    await logAuditEntry(ctx, "mailbox.status_denied", "denied", {
      conversationId,
      mailboxId: conversation.mailboxId,
      reason: "canUpdateStatus_false",
    });
    return errorJson("Forbidden — you do not have status update permission for this mailbox", 403);
  }

  // Update ticket state on Zammad
  // Note: for "pending", the client auto-sets pending_time to now + 24h
  const result = await updateTicketState(conversationId, validation.status);

  if (!result.ok) {
    if (result.status === 404) {
      return errorJson("Email này không còn tồn tại hoặc đã bị xóa.", 404);
    }
    if (result.status === 409) {
      return errorJson("Conflict — conversation may have been modified", 409);
    }
    if (result.status === 422) {
      return errorJson("Validation error from email system", 422);
    }
    return handleUpstreamError(result.status);
  }

  await logAuditEntry(ctx, "mailbox.status_changed", "success", {
    conversationId,
    mailboxId: conversation.mailboxId,
    newStatus: validation.status,
  });

  return json({ success: true });
}

// ──────────────────────────── Error mapping ────────────────────────────

function handleUpstreamError(status: number) {
  if (status === 401 || status === 403) {
    // Admin API token issue — log but show generic error to operators
    console.error("[ZAMMAD] Admin API token rejected (status %d)", status);
    return errorJson("Không thể kết nối đến hệ thống email. Vui lòng thử lại sau.", 502);
  }
  if (status === 502 || status === 0) {
    return errorJson("Không thể kết nối đến hệ thống email. Vui lòng thử lại sau.", 502);
  }
  return errorJson("Có lỗi từ hệ thống email. Vui lòng thử lại sau.", 502);
}

// ──────────────────────────── Audit helper ────────────────────────────

async function logAuditEntry(
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
  action: string,
  result: string,
  metadata: Record<string, unknown>,
) {
  await logAudit({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    action,
    resourceType: "mailbox",
    resourceId: metadata.conversationId
      ? String(metadata.conversationId)
      : metadata.mailboxId
        ? String(metadata.mailboxId)
        : null,
    metadata: {
      ...metadata,
      result,
      zammadUserId: ctx.zammadUserId,
    },
  });
}

// ──────────────────────────── Exports ────────────────────────────

export const GET = handler;
export const POST = handler;
export const PUT = handler;
