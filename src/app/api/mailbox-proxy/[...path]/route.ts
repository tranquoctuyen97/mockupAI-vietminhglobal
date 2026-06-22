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
 * - Store-scoped: every endpoint requires storeId
 * - Feature-based access: user with mailboxes feature + ZammadUser can reply/update
 * - Redacts API tokens from all logs
 * - 10-second timeout on upstream requests
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { parseEmailIdentity } from "@/lib/mailboxes/identity";
import {
  getMailboxAuthContext,
  listStoreMailboxes,
  requireActiveStoreMailbox,
  requireZammadUser,
} from "@/lib/zammad/auth";
import {
  createTicketArticle,
  formatMailboxFrom,
  getTicket,
  getTicketArticles,
  searchTicketsWithIdentity,
  updateTicketState,
} from "@/lib/zammad/client";
import type { AppStatus } from "@/lib/zammad/types";
import { validateReplyBody, validateStatusBody } from "@/lib/zammad/validation";

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

async function handler(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
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
  // GET /mailboxes?storeId=...
  if (method === "GET" && proxyPath === "/mailboxes") {
    return handleListMailboxes(request, ctx);
  }

  // GET /conversations?storeId=...&mailboxId=...
  if (method === "GET" && proxyPath === "/conversations") {
    return handleListConversations(request, ctx);
  }

  // GET /conversations/:id?storeId=...
  const convDetailMatch = proxyPath.match(/^\/conversations\/(\d+)$/);
  if (method === "GET" && convDetailMatch) {
    return handleGetConversation(request, Number(convDetailMatch[1]), ctx);
  }

  // POST /conversations/:id/threads?storeId=...
  const replyMatch = proxyPath.match(/^\/conversations\/(\d+)\/threads$/);
  if (method === "POST" && replyMatch) {
    return handleReply(request, Number(replyMatch[1]), ctx);
  }

  // PUT /conversations/:id?storeId=...
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

// ──────────────────────────── Store validation helper ────────────────────────

/**
 * Validate storeId and return the storeId string or an error response.
 */
function extractStoreId(searchParams: URLSearchParams): string | NextResponse {
  const raw = searchParams.get("storeId");
  if (!raw || typeof raw !== "string" || raw.length === 0) {
    return errorJson("storeId is required", 422);
  }
  return raw;
}

// ──────────────────────────── GET /mailboxes?storeId=... ────────────────────

async function handleListMailboxes(
  request: NextRequest,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;

  const appMailboxes = await listStoreMailboxes(ctx, storeId);

  return json({
    mailboxes: appMailboxes.map((m) => ({
      id: m.zammadGroupId,
      name: m.name,
      active: true,
    })),
    storeId,
  });
}

// ──────────────────────────── GET /conversations?storeId=...&mailboxId=... ──

async function handleListConversations(
  request: NextRequest,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  const url = request.nextUrl;

  // Validate storeId
  const storeId = extractStoreId(url.searchParams);
  if (storeId instanceof NextResponse) return storeId;

  // Validate mailboxId
  const mailboxIdRaw = url.searchParams.get("mailboxId");
  if (!mailboxIdRaw || !/^\d+$/.test(mailboxIdRaw)) {
    return errorJson("mailboxId is required and must be a positive integer", 422);
  }
  const mailboxId = Number(mailboxIdRaw);

  // Enforce store-scoped active mailbox
  const mailbox = await requireActiveStoreMailbox(ctx, storeId, mailboxId);
  if (!mailbox) {
    await logAuditEntry(ctx, "mailbox.conversation_list_denied", "denied", {
      storeId,
      mailboxId,
    });
    return errorJson("Forbidden — mailbox not found or not active for this store", 403);
  }

  // Parse and validate optional params
  const status = url.searchParams.get("status") as AppStatus | null;
  const validStatuses: AppStatus[] = ["active", "pending", "closed"];
  const effectiveStatus = status && validStatuses.includes(status) ? status : undefined;

  const pageRaw = url.searchParams.get("page");
  const page = pageRaw && /^\d+$/.test(pageRaw) && Number(pageRaw) > 0 ? Number(pageRaw) : 1;

  const pageSizeRaw = url.searchParams.get("pageSize");
  const pageSize =
    pageSizeRaw && /^\d+$/.test(pageSizeRaw) ? Math.min(Number(pageSizeRaw), 100) : 25;

  const result = await searchTicketsWithIdentity({
    groupId: mailboxId,
    status: effectiveStatus,
    page,
    pageSize,
  });

  if (!result.ok) return handleUpstreamError(result.status);

  return json({
    conversations: result.data ?? [],
    page: {
      size: pageSize,
      number: page,
      totalElements:
        (result.data?.length ?? 0) < pageSize
          ? (page - 1) * pageSize + (result.data?.length ?? 0)
          : -1,
      totalPages: (result.data?.length ?? 0) < pageSize ? page : page + 1,
    },
  });
}

// ──────────────────────────── GET /conversations/:id?storeId=... ────────────

async function handleGetConversation(
  request: NextRequest,
  conversationId: number,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  // Validate storeId
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;

  // Fetch ticket
  const ticketResult = await getTicket(conversationId);

  if (!ticketResult.ok) {
    if (ticketResult.status === 404) {
      return errorJson("Email này không còn tồn tại hoặc đã bị xóa.", 404);
    }
    return handleUpstreamError(ticketResult.status);
  }

  const conversation = ticketResult.data;
  if (!conversation) {
    return errorJson("Không thể lấy thông tin cuộc trò chuyện từ hệ thống.", 502);
  }

  // Enforce store-scoped active mailbox
  const mailbox = await requireActiveStoreMailbox(ctx, storeId, conversation.mailboxId);
  if (!mailbox) {
    await logAuditEntry(ctx, "mailbox.conversation_read_denied", "denied", {
      storeId,
      conversationId,
      mailboxId: conversation.mailboxId,
    });
    return errorJson("Forbidden — no access to this conversation", 403);
  }

  // Fetch articles
  const articlesResult = await getTicketArticles(conversationId);
  const threads = articlesResult.ok ? (articlesResult.data ?? []) : [];

  return json({
    conversation,
    threads,
  });
}

// ──────────────────────────── POST /conversations/:id/threads?storeId=... ────

async function handleReply(
  request: NextRequest,
  conversationId: number,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  // Validate storeId
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;

  // Require ZammadUser mapping
  if (!requireZammadUser(ctx)) {
    return errorJson(
      "Tài khoản email của bạn chưa được cấu hình. Vui lòng liên hệ SUPER_ADMIN.",
      404,
    );
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

  const conversation = ticketResult.data;
  if (!conversation) {
    return errorJson("Không thể lấy thông tin cuộc trò chuyện từ hệ thống.", 502);
  }

  // Enforce store-scoped active mailbox (feature-based access)
  const mailbox = await requireActiveStoreMailbox(ctx, storeId, conversation.mailboxId);
  if (!mailbox) {
    await logAuditEntry(ctx, "mailbox.reply_denied", "denied", {
      storeId,
      conversationId,
      mailboxId: conversation.mailboxId,
      reason: "mailbox_not_active_for_store",
    });
    return errorJson("Forbidden — no access to this conversation", 403);
  }

  // Fetch articles to extract the customer's email address
  const articlesResult = await getTicketArticles(conversationId);
  if (!articlesResult.ok || !articlesResult.data) {
    return errorJson("Không thể lấy thông tin cuộc trò chuyện từ hệ thống.", 502);
  }

  const threads = articlesResult.data;
  const firstInbound = threads.find((t) => !t.internal && t.from);
  if (!firstInbound || !firstInbound.from) {
    return errorJson("Không tìm thấy địa chỉ người nhận cho phản hồi này.", 422);
  }

  const customerEmail = parseEmailIdentity(firstInbound.from).email;
  if (!customerEmail) {
    return errorJson("Địa chỉ email người nhận phản hồi không hợp lệ.", 422);
  }

  // Create article on Zammad
  const result = await createTicketArticle(
    conversationId,
    validation.text,
    customerEmail,
    formatMailboxFrom({ displayName: mailbox.name, email: mailbox.email }),
  );

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
    storeId,
    conversationId,
    mailboxId: conversation.mailboxId,
  });

  return json({ success: true }, 201);
}

// ──────────────────────────── PUT /conversations/:id?storeId=... ────────────

async function handleStatusUpdate(
  request: NextRequest,
  conversationId: number,
  ctx: Awaited<ReturnType<typeof getMailboxAuthContext>>,
) {
  // Validate storeId
  const storeId = extractStoreId(request.nextUrl.searchParams);
  if (storeId instanceof NextResponse) return storeId;

  // Require ZammadUser mapping
  if (!requireZammadUser(ctx)) {
    return errorJson(
      "Tài khoản email của bạn chưa được cấu hình. Vui lòng liên hệ SUPER_ADMIN.",
      404,
    );
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

  const conversation = ticketResult.data;
  if (!conversation) {
    return errorJson("Không thể lấy thông tin cuộc trò chuyện từ hệ thống.", 502);
  }

  // Enforce store-scoped active mailbox (feature-based access)
  const mailbox = await requireActiveStoreMailbox(ctx, storeId, conversation.mailboxId);
  if (!mailbox) {
    await logAuditEntry(ctx, "mailbox.status_denied", "denied", {
      storeId,
      conversationId,
      mailboxId: conversation.mailboxId,
      reason: "mailbox_not_active_for_store",
    });
    return errorJson("Forbidden — no access to this conversation", 403);
  }

  // Update ticket state on Zammad
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
    storeId,
    conversationId,
    mailboxId: conversation.mailboxId,
    newStatus: validation.status,
  });

  return json({ success: true });
}

// ──────────────────────────── Error mapping ────────────────────────────

function handleUpstreamError(status: number) {
  if (status === 401 || status === 403) {
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
