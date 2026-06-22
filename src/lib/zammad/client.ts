/**
 * Zammad API client — server-only.
 *
 * Uses a single admin API token (ZAMMAD_ADMIN_TOKEN) to make all
 * upstream calls. ZAMMAD_URL is trimmed of trailing slashes.
 * Default 10-second timeout (configurable per-request).
 * Token and passwords are redacted from all logs.
 */

import type {
  AppStatus,
  NormalizedConversation,
  NormalizedMailbox,
  NormalizedThread,
  ZammadArticle,
  ZammadChannelAsset,
  ZammadChannelsEmailResponse,
  ZammadConnectionTestResult,
  ZammadGroup,
  ZammadInboundConfig,
  ZammadOutboundConfig,
  ZammadSetting,
  ZammadTicket,
  ZammadVerifyInput,
} from "./types";

import {
  appStatusToZammadSearchStates,
  appStatusToZammadUpdateState,
  enrichConversationIdentity,
  normalizeArticle,
  normalizeGroup,
  normalizeTicket,
} from "./types";

const TIMEOUT_MS = 10_000;
const VERIFY_TIMEOUT_MS = 45_000;
export const ZAMMAD_SYSTEM_ADDRESS_SENDER_FORMAT = "SystemAddressName";

export interface MailboxOutboundIdentity {
  displayName: string;
  email: string;
}

function getBaseUrl(): string {
  const url = process.env.ZAMMAD_URL;
  if (!url) throw new Error("[ZAMMAD] ZAMMAD_URL is not set");
  return url.replace(/\/+$/, ""); // normalize trailing slashes
}

function getAdminToken(): string {
  const token = process.env.ZAMMAD_ADMIN_TOKEN;
  if (!token) throw new Error("[ZAMMAD] ZAMMAD_ADMIN_TOKEN is not set");
  return token;
}

// ─── Generic request ────────────────────────────────────────────────────────

export type ZammadMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ZammadRequestOptions {
  method: ZammadMethod;
  path: string; // e.g. "/api/v1/groups"
  queryParams?: URLSearchParams;
  body?: Record<string, unknown>;
  timeoutMs?: number; // override default 10s timeout
}

export interface ZammadResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Make a request to Zammad's REST API.
 * Returns { ok, status, data, error }.
 */
export async function zammadRequest<T = unknown>(
  options: ZammadRequestOptions,
): Promise<ZammadResponse<T>> {
  const baseUrl = getBaseUrl();
  const token = getAdminToken();

  let url = `${baseUrl}${options.path}`;
  if (options.queryParams?.toString()) {
    url += `?${options.queryParams.toString()}`;
  }

  const controller = new AbortController();
  const effectiveTimeout = options.timeoutMs ?? TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  const headers: Record<string, string> = {
    Authorization: `Token token=${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Read error body but never expose it raw (may contain sensitive data)
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {
        // ignore
      }

      // Log with status code but redact token and response body
      console.error(
        `[ZAMMAD] Upstream ${options.method} ${options.path} returned ${response.status}`,
      );

      return {
        ok: false,
        status: response.status,
        data: null,
        error: errorText,
      };
    }

    const data = (await response.json()) as T;
    return { ok: true, status: response.status, data };
  } catch (err) {
    clearTimeout(timeoutId);

    const isTimeout = err instanceof DOMException && err.name === "AbortError";

    console.error(
      `[ZAMMAD] ${isTimeout ? "Timeout" : "Network error"} on ${options.method} ${options.path}`,
      isTimeout ? "" : err,
    );

    return {
      ok: false,
      status: 502,
      data: null,
      error: isTimeout ? "timeout" : "network_error",
    };
  }
}

// ─── Typed helpers ──────────────────────────────────────────────────────────

/** List all Zammad groups (= mailboxes) */
export async function listGroups(): Promise<ZammadResponse<NormalizedMailbox[]>> {
  const result = await zammadRequest<ZammadGroup[]>({
    method: "GET",
    path: "/api/v1/groups",
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null };
  }

  return {
    ok: true,
    status: result.status,
    data: result.data.filter((g) => g.active).map(normalizeGroup),
  };
}

/** Search tickets by group + status with pagination */
export async function searchTickets(opts: {
  groupId: number;
  status?: AppStatus;
  page?: number;
  pageSize?: number;
}): Promise<ZammadResponse<NormalizedConversation[]>> {
  const qp = new URLSearchParams();

  // Build search query
  const queryParts: string[] = [`group_id:${opts.groupId}`];
  if (opts.status) {
    const states = appStatusToZammadSearchStates(opts.status);
    if (states.length === 1) {
      queryParts.push(`state.name:"${states[0]}"`);
    } else {
      // OR query: (state.name:"new" OR state.name:"open")
      const stateQuery = states.map((s) => `state.name:"${s}"`).join(" OR ");
      queryParts.push(`(${stateQuery})`);
    }
  }

  qp.set("query", queryParts.join(" AND "));
  qp.set("sort_by", "updated_at");
  qp.set("order_by", "desc");
  qp.set("limit", String(opts.pageSize ?? 25));
  qp.set("page", String(opts.page ?? 1));

  const result = await zammadRequest<ZammadTicket[]>({
    method: "GET",
    path: "/api/v1/tickets/search",
    queryParams: qp,
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null };
  }

  return {
    ok: true,
    status: result.status,
    data: result.data.map(normalizeTicket),
  };
}

export async function searchTicketsWithIdentity(opts: {
  groupId: number;
  status?: AppStatus;
  page?: number;
  pageSize?: number;
}): Promise<ZammadResponse<NormalizedConversation[]>> {
  const result = await searchTickets(opts);
  if (!result.ok || !result.data) {
    return result;
  }

  const conversations = await Promise.all(
    result.data.map(async (conversation) => {
      const articles = await getTicketArticles(conversation.id);
      if (!articles.ok || !articles.data) return conversation;
      return enrichConversationIdentity(conversation, articles.data);
    }),
  );

  return {
    ok: true,
    status: result.status,
    data: conversations,
  };
}

/** Get a single ticket by ID */
export async function getTicket(ticketId: number): Promise<ZammadResponse<NormalizedConversation>> {
  const result = await zammadRequest<ZammadTicket>({
    method: "GET",
    path: `/api/v1/tickets/${ticketId}`,
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null };
  }

  return {
    ok: true,
    status: result.status,
    data: normalizeTicket(result.data),
  };
}

/** Get all articles for a ticket */
export async function getTicketArticles(
  ticketId: number,
): Promise<ZammadResponse<NormalizedThread[]>> {
  const result = await zammadRequest<ZammadArticle[]>({
    method: "GET",
    path: `/api/v1/ticket_articles/by_ticket/${ticketId}`,
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null };
  }

  return {
    ok: true,
    status: result.status,
    data: result.data.map(normalizeArticle),
  };
}

/** Create a reply article on a ticket */
export async function createTicketArticle(
  ticketId: number,
  text: string,
  to: string,
  from?: string,
): Promise<ZammadResponse<NormalizedThread>> {
  const result = await zammadRequest<ZammadArticle>({
    method: "POST",
    path: "/api/v1/ticket_articles",
    body: {
      ticket_id: ticketId,
      body: text,
      content_type: "text/plain",
      type: "email",
      sender: "Agent",
      ...(from ? { from } : {}),
      to,
      internal: false,
    },
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null };
  }

  return {
    ok: true,
    status: result.status,
    data: normalizeArticle(result.data),
  };
}

/** Update ticket state */
export async function updateTicketState(
  ticketId: number,
  status: AppStatus,
): Promise<ZammadResponse<NormalizedConversation>> {
  const zammadState = appStatusToZammadUpdateState(status);

  const body: Record<string, unknown> = { state: zammadState };

  // Zammad requires pending_time for "pending reminder" state
  if (status === "pending") {
    // Default: 24 hours from now
    const pendingTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    body.pending_time = pendingTime;
  }

  const result = await zammadRequest<ZammadTicket>({
    method: "PUT",
    path: `/api/v1/tickets/${ticketId}`,
    body,
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null };
  }

  return {
    ok: true,
    status: result.status,
    data: normalizeTicket(result.data),
  };
}

// ─── Admin helpers — Group CRUD ─────────────────────────────────────────────

/** Create a new Zammad group */
export async function createGroup(input: {
  name: string;
  active?: boolean;
}): Promise<ZammadResponse<ZammadGroup>> {
  return zammadRequest<ZammadGroup>({
    method: "POST",
    path: "/api/v1/groups",
    body: { name: input.name, active: input.active ?? true },
  });
}

/**
 * Assign the API token's admin user to a group with full access.
 *
 * Without this, newly created groups are invisible via the API because
 * Zammad's ticket search is scoped to the requesting user's group_ids.
 */
export async function assignAdminToGroup(groupId: number): Promise<ZammadResponse<unknown>> {
  // 1. Get current admin user + their group permissions
  const meResult = await zammadRequest<{
    id: number;
    group_ids: Record<string, string[]>;
  }>({
    method: "GET",
    path: "/api/v1/users/me",
  });
  if (!meResult.ok || !meResult.data) return meResult;

  // 2. Merge new group into existing group_ids
  const currentGroups = meResult.data.group_ids || {};
  const updatedGroups = {
    ...currentGroups,
    [String(groupId)]: ["full"],
  };

  // 3. Update admin user
  return zammadRequest({
    method: "PUT",
    path: `/api/v1/users/${meResult.data.id}`,
    body: { group_ids: updatedGroups },
  });
}

/** Update an existing Zammad group */
export async function updateGroup(
  groupId: number,
  input: { name?: string; active?: boolean },
): Promise<ZammadResponse<ZammadGroup>> {
  return zammadRequest<ZammadGroup>({
    method: "PUT",
    path: `/api/v1/groups/${groupId}`,
    body: input as Record<string, unknown>,
  });
}

/** Delete a Zammad group */
export async function deleteGroup(groupId: number): Promise<ZammadResponse<Record<string, never>>> {
  return zammadRequest<Record<string, never>>({
    method: "DELETE",
    path: `/api/v1/groups/${groupId}`,
  });
}

// ─── Admin helpers — Email Channel ──────────────────────────────────────────

/** List all email channels (returns assets with masked passwords) */
export async function listEmailChannels(): Promise<ZammadResponse<ZammadChannelsEmailResponse>> {
  return zammadRequest<ZammadChannelsEmailResponse>({
    method: "GET",
    path: "/api/v1/channels_email",
  });
}

/** Auto-probe email settings by email + password (tests IMAP+SMTP → needs longer timeout) */
export async function probeEmailSettings(input: {
  email: string;
  password: string;
}): Promise<ZammadResponse<ZammadConnectionTestResult>> {
  return zammadRequest<ZammadConnectionTestResult>({
    method: "POST",
    path: "/api/v1/channels_email_probe",
    body: redactForRequest({ email: input.email, password: input.password }),
    timeoutMs: VERIFY_TIMEOUT_MS,
  });
}

/** Test inbound (IMAP) connection */
export async function testEmailInbound(
  input: ZammadInboundConfig,
): Promise<ZammadResponse<ZammadConnectionTestResult>> {
  return zammadRequest<ZammadConnectionTestResult>({
    method: "POST",
    path: "/api/v1/channels_email_inbound",
    body: input as unknown as Record<string, unknown>,
  });
}

/** Test outbound (SMTP) connection */
export async function testEmailOutbound(
  input: ZammadOutboundConfig & { email: string },
): Promise<ZammadResponse<ZammadConnectionTestResult>> {
  const { email, ...config } = input;
  return zammadRequest<ZammadConnectionTestResult>({
    method: "POST",
    path: "/api/v1/channels_email_outbound",
    body: { ...config, email } as unknown as Record<string, unknown>,
  });
}

/**
 * Verify and create/update an email channel.
 * This endpoint blocks up to 30s for delivery test → uses 45s timeout.
 */
export async function verifyEmailChannel(
  input: ZammadVerifyInput,
): Promise<ZammadResponse<ZammadConnectionTestResult>> {
  return zammadRequest<ZammadConnectionTestResult>({
    method: "POST",
    path: "/api/v1/channels_email_verify",
    body: input as unknown as Record<string, unknown>,
    timeoutMs: VERIFY_TIMEOUT_MS,
  });
}

/** Enforce Zammad's global outgoing sender format for all email replies. */
export async function ensureSystemAddressSenderFormat(): Promise<ZammadResponse<ZammadSetting>> {
  const settingsResult = await zammadRequest<ZammadSetting[]>({
    method: "GET",
    path: "/api/v1/settings",
  });

  if (!settingsResult.ok || !settingsResult.data) {
    return { ...settingsResult, data: null };
  }

  const setting = settingsResult.data.find((item) => item.name === "ticket_define_email_from");
  if (!setting) {
    return {
      ok: false,
      status: 404,
      data: null,
      error: "Zammad setting ticket_define_email_from not found",
    };
  }

  const currentValue = setting.state_current?.value ?? setting.state;
  if (currentValue === ZAMMAD_SYSTEM_ADDRESS_SENDER_FORMAT) {
    return { ok: true, status: settingsResult.status, data: setting };
  }

  const updateResult = await zammadRequest<ZammadSetting>({
    method: "PUT",
    path: `/api/v1/settings/${setting.id}`,
    body: { state: ZAMMAD_SYSTEM_ADDRESS_SENDER_FORMAT },
  });

  if (!updateResult.ok || !updateResult.data) {
    return { ...updateResult, data: null };
  }

  return updateResult;
}

/** Enable a disabled email channel */
export async function enableEmailChannel(
  channelId: number,
): Promise<ZammadResponse<Record<string, never>>> {
  return zammadRequest<Record<string, never>>({
    method: "POST",
    path: "/api/v1/channels_email_enable",
    body: { id: channelId },
  });
}

/** Disable an email channel */
export async function disableEmailChannel(
  channelId: number,
): Promise<ZammadResponse<Record<string, never>>> {
  return zammadRequest<Record<string, never>>({
    method: "POST",
    path: "/api/v1/channels_email_disable",
    body: { id: channelId },
  });
}

/** Delete an email channel after a failed mailbox create rollback */
export async function deleteEmailChannel(
  channelId: number,
): Promise<ZammadResponse<Record<string, never>>> {
  return zammadRequest<Record<string, never>>({
    method: "DELETE",
    path: "/api/v1/channels_email",
    body: { id: channelId },
  });
}

/**
 * Find a channel by group_id after verify creates it.
 *
 * Hardened matching:
 * 1. Only considers active Email::Account channels
 * 2. If multiple matches, prefers one matching the given email
 * 3. If still ambiguous, returns null (caller should log warning)
 */
export async function findChannelByGroupId(
  groupId: number,
  email?: string,
): Promise<ZammadChannelAsset | null> {
  const result = await listEmailChannels();
  if (!result.ok || !result.data) return null;

  const channels = Object.values(result.data.assets.Channel ?? {});
  const matches = channels.filter(
    (ch) => ch.area === "Email::Account" && ch.group_id === groupId && ch.active,
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Multiple matches — prefer one with matching email in options
  if (email) {
    const emailMatch = matches.find((ch) => {
      const inboundUser = (ch.options?.inbound as Record<string, unknown>)?.options as
        | Record<string, unknown>
        | undefined;
      return inboundUser?.user === email;
    });
    if (emailMatch) return emailMatch;
  }

  // Still ambiguous — return null to force manual resolution
  console.error(
    `[ZAMMAD] Multiple Email::Account channels found for group_id=${groupId}. Manual cleanup required.`,
  );
  return null;
}

/**
 * Update inbound options on an existing email channel.
 * Used to set keep_on_server after channel creation.
 */
export async function updateEmailChannelInbound(
  channelId: number,
  inboundOverrides: Record<string, unknown>,
  identity?: MailboxOutboundIdentity,
): Promise<ZammadResponse<unknown>> {
  // Get current channel config from the assets list
  const channelsResult = await listEmailChannels();
  if (!channelsResult.ok || !channelsResult.data) {
    return {
      ok: false,
      status: channelsResult.status,
      data: null,
      error:
        channelsResult.error ??
        `Failed to load email channels before updating channel ${channelId}`,
    };
  }

  const channel = channelsResult.data.assets.Channel[String(channelId)];
  if (!channel) {
    return {
      ok: false,
      status: 404,
      data: null,
      error: `Email channel ${channelId} not found`,
    };
  }

  const currentOptions = channel.options as Record<string, unknown>;
  const currentInbound = currentOptions.inbound as Record<string, unknown> | undefined;
  const currentOutbound = currentOptions.outbound as Record<string, unknown> | undefined;
  const currentInboundOptions = (currentInbound?.options ?? {}) as Record<string, unknown>;
  const mergedInboundOptions = { ...currentInboundOptions, ...inboundOverrides };
  const fallbackEmail =
    typeof mergedInboundOptions.user === "string"
      ? mergedInboundOptions.user
      : `channel-${channelId}@localhost`;
  const email = identity?.email ?? fallbackEmail;
  const realname =
    identity?.displayName ?? getEmailAddressRealname(channelsResult.data, channelId) ?? email;

  // Generic IMAP/SMTP channels are updated through Zammad's verify endpoint.
  // The channel_id lets Zammad unmask existing password values.
  return zammadRequest({
    method: "POST",
    path: "/api/v1/channels_email_verify",
    timeoutMs: VERIFY_TIMEOUT_MS,
    body: {
      meta: {
        realname,
        email,
      },
      group_id: channel.group_id,
      channel_id: channelId,
      inbound: {
        ...(currentInbound ?? {}),
        options: mergedInboundOptions,
      },
      outbound: currentOutbound ?? {},
    },
  });
}

export function formatMailboxFrom(identity: MailboxOutboundIdentity): string {
  const displayName = identity.displayName.trim() || identity.email;
  const escapedDisplayName = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escapedDisplayName}" <${identity.email}>`;
}

function getEmailAddressRealname(
  channels: ZammadChannelsEmailResponse,
  channelId: number,
): string | null {
  const emailAddresses = Object.values(channels.assets.EmailAddress ?? {});
  const match = emailAddresses.find((address) => address.channel_id === channelId);
  return match?.realname?.trim() || null;
}

/**
 * Apply the app's fixed mailbox history window.
 *
 * This intentionally fails closed until we verify the exact Zammad channel
 * option that limits initial IMAP history by date. Returning success here
 * without that support would risk importing the whole mailbox.
 */
export async function applyMailboxHistoryWindow(
  channelId: number,
): Promise<ZammadResponse<unknown>> {
  return {
    ok: false,
    status: 422,
    data: null,
    error: `Zammad channel ${channelId} does not have a verified six-month history-window mapping yet`,
  };
}

// ─── Password redaction utility ─────────────────────────────────────────────

/** Redact password fields from an object for logging. Never mutates the original. */
export function redactPasswords<T extends Record<string, unknown>>(obj: T): T {
  const clone = JSON.parse(JSON.stringify(obj)) as T;
  function walk(o: Record<string, unknown>) {
    for (const key of Object.keys(o)) {
      if (typeof key === "string" && /password/i.test(key) && typeof o[key] === "string") {
        o[key] = "[REDACTED]";
      } else if (o[key] && typeof o[key] === "object" && !Array.isArray(o[key])) {
        walk(o[key] as Record<string, unknown>);
      }
    }
  }
  walk(clone as Record<string, unknown>);
  return clone;
}

/** Pass-through for request body (does not redact — Zammad needs real passwords) */
function redactForRequest(body: Record<string, unknown>): Record<string, unknown> {
  return body;
}
