import { APP_TO_RT_STATUS, normalizeRtTicket, normalizeRtTransaction } from "./normalizers";
import type {
  AppStatus,
  RtAttachmentDetail,
  NormalizedConversation,
  NormalizedLabel,
  NormalizedPage,
  NormalizedThread,
  RtCollection,
  RtAttachment,
  RtCustomField,
  RtQueue,
  RtTicket,
  RtTransaction,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
const GMAIL_LABELS_FIELD = "Gmail Labels";

export type RtMethod = "GET" | "POST" | "PUT" | "DELETE";
export interface RtResponse<T> { ok: boolean; status: number; data: T | null; error?: string }
export interface RtRequestOptions {
  method: RtMethod;
  path: string;
  queryParams?: URLSearchParams;
  body?: unknown;
  timeoutMs?: number;
}

function runtimeConfig() {
  const url = process.env.RT_URL?.replace(/\/+$/, "");
  const token = process.env.RT_API_TOKEN;
  if (!url) throw new Error("RT_URL is not configured");
  if (!token) throw new Error("RT_API_TOKEN is not configured");
  return { url, token };
}

export async function rtRequest<T = unknown>(options: RtRequestOptions): Promise<RtResponse<T>> {
  const { url: baseUrl, token } = runtimeConfig();
  const query = options.queryParams?.toString();
  const url = `${baseUrl}${options.path}${query ? `?${query}` : ""}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, data: null, error: `rt_upstream_${response.status}` };
    }
    if (response.status === 204) return { ok: true, status: response.status, data: null };
    return { ok: true, status: response.status, data: await response.json() as T };
  } catch (error) {
    const timeoutError = error instanceof DOMException && error.name === "AbortError";
    return { ok: false, status: 502, data: null, error: timeoutError ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

function ticketSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizePage<T, U>(page: RtCollection<T>, map: (item: T) => U): NormalizedPage<U> {
  return {
    items: page.items.map(map),
    count: page.count,
    page: page.page,
    pages: page.pages,
    pageSize: page.per_page,
    total: page.total,
    nextPage: page.next_page ?? null,
    previousPage: page.prev_page ?? null,
  };
}

export async function searchTickets(options: {
  queueId: number;
  mailboxId?: string;
  status?: AppStatus;
  labelName?: string;
  labels?: NormalizedLabel[];
  page?: number;
  pageSize?: number;
}): Promise<RtResponse<NormalizedPage<NormalizedConversation>>> {
  if (!Number.isSafeInteger(options.queueId) || options.queueId <= 0) throw new Error("invalid_queue_id");
  const clauses = [`Queue = ${options.queueId}`];
  if (options.status) clauses.push(`Status = '${APP_TO_RT_STATUS[options.status]}'`);
  if (options.labelName) clauses.push(`CF.{${GMAIL_LABELS_FIELD}} = '${ticketSqlString(options.labelName)}'`);
  const query = new URLSearchParams({
    query: clauses.join(" AND "),
    page: String(options.page ?? 1),
    per_page: String(Math.min(100, Math.max(1, options.pageSize ?? 25))),
    fields: "Subject,Status,Created,LastUpdated,EffectiveId,Requestor,CustomFields,TransactionCount",
  });
  const response = await rtRequest<RtCollection<RtTicket>>({ method: "GET", path: "/REST/2.0/tickets", queryParams: query });
  if (!response.ok || !response.data) return { ...response, data: null };
  return {
    ok: true,
    status: response.status,
    data: normalizePage(response.data, (ticket) => normalizeRtTicket(ticket, options.mailboxId ?? String(options.queueId), options.labels)),
  };
}

export async function listTicketsByIds(options: {
  queueId: number;
  ticketIds: number[];
  mailboxId?: string;
  labels?: NormalizedLabel[];
}): Promise<RtResponse<NormalizedConversation[]>> {
  const ticketIds = Array.from(
    new Set(
      options.ticketIds.filter((ticketId) => Number.isSafeInteger(ticketId) && ticketId > 0),
    ),
  );
  if (ticketIds.length === 0) {
    return { ok: true, status: 200, data: [] };
  }

  const idClauses = ticketIds.map((ticketId) => `id = ${ticketId}`).join(" OR ");
  const query = new URLSearchParams({
    query: `Queue = ${options.queueId} AND (${idClauses})`,
    page: "1",
    per_page: String(Math.min(100, Math.max(1, ticketIds.length))),
    fields: "Subject,Status,Created,LastUpdated,EffectiveId,Requestor,CustomFields,TransactionCount",
  });
  const response = await rtRequest<RtCollection<RtTicket>>({
    method: "GET",
    path: "/REST/2.0/tickets",
    queryParams: query,
  });
  if (!response.ok || !response.data) return { ...response, data: null };

  const normalizedById = new Map(
    response.data.items.map((ticket) => {
      const normalized = normalizeRtTicket(
        ticket,
        options.mailboxId ?? String(options.queueId),
        options.labels,
      );
      return [normalized.id, normalized] as const;
    }),
  );

  return {
    ok: true,
    status: response.status,
    data: ticketIds
      .map((ticketId) => normalizedById.get(ticketId))
      .filter((ticket): ticket is NormalizedConversation => Boolean(ticket)),
  };
}

export const getTicket = (ticketId: number) => rtRequest<RtTicket>({ method: "GET", path: `/REST/2.0/ticket/${ticketId}` });

export async function getTicketTransactions(ticketId: number): Promise<RtResponse<NormalizedPage<NormalizedThread>>> {
  const queryParams = new URLSearchParams({
    fields: "Ticket,Type,Creator,Created,Content,ContentType,Subject,From,To,Cc,Attachments",
  });
  const response = await rtRequest<RtCollection<RtTransaction>>({
    method: "GET",
    path: `/REST/2.0/ticket/${ticketId}/history`,
    queryParams,
  });
  if (!response.ok || !response.data) return { ...response, data: null };
  return { ok: true, status: response.status, data: normalizePage(response.data, normalizeRtTransaction) };
}

export const getTicketAttachments = (ticketId: number) =>
  rtRequest<RtCollection<Record<string, unknown>>>({ method: "GET", path: `/REST/2.0/ticket/${ticketId}/attachments` });

export const getAttachment = (attachmentId: number) =>
  rtRequest<RtAttachmentDetail>({ method: "GET", path: `/REST/2.0/attachment/${attachmentId}` });

export async function getTicketAttachmentDetails(ticketId: number): Promise<RtResponse<RtAttachmentDetail[]>> {
  const listing = await getTicketAttachments(ticketId);
  if (!listing.ok || !listing.data) return { ...listing, data: null };

  const attachmentIds = listing.data.items
    .map((item) => Number((item as { id?: string | number }).id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  if (attachmentIds.length === 0) {
    return { ok: true, status: listing.status, data: [] };
  }

  const details = await Promise.all(attachmentIds.map((attachmentId) => getAttachment(attachmentId)));
  const firstFailure = details.find((detail) => !detail.ok || !detail.data);
  if (firstFailure) return { ok: false, status: firstFailure.status, data: null, error: firstFailure.error };

  return {
    ok: true,
    status: listing.status,
    data: details.map((detail) => detail.data!).filter(Boolean),
  };
}

export const correspond = (ticketId: number, input: { content: string; contentType: string }) =>
  rtRequest<RtTransaction>({ method: "POST", path: `/REST/2.0/ticket/${ticketId}/correspond`, body: { Content: input.content, ContentType: input.contentType } });

export const comment = (ticketId: number, input: { content: string; contentType: string }) =>
  rtRequest<RtTransaction>({ method: "POST", path: `/REST/2.0/ticket/${ticketId}/comment`, body: { Content: input.content, ContentType: input.contentType } });

export const updateTicketStatus = (ticketId: number, status: AppStatus) =>
  rtRequest<RtTicket>({ method: "PUT", path: `/REST/2.0/ticket/${ticketId}`, body: { Status: APP_TO_RT_STATUS[status] } });

export const listQueues = () => rtRequest<RtCollection<RtQueue>>({ method: "GET", path: "/REST/2.0/queues/all" });
export async function findQueueByName(name: string): Promise<RtResponse<RtQueue | null>> {
  const response = await rtRequest<RtCollection<RtQueue>>({
    method: "GET",
    path: "/REST/2.0/queues/all",
    queryParams: new URLSearchParams({
      fields: "id,Name,Description,CorrespondAddress,Disabled",
      find_disabled_rows: "1",
    }),
  });
  if (!response.ok || !response.data) return { ...response, data: null };
  return {
    ok: true,
    status: response.status,
    data: response.data.items.find((queue) => queue.Name === name) ?? null,
  };
}
export const createQueue = (input: { name: string; description: string; correspondAddress: string }) =>
  rtRequest<RtQueue>({ method: "POST", path: "/REST/2.0/queue", body: { Name: input.name, Description: input.description, CorrespondAddress: input.correspondAddress } });
export const updateQueue = (queueId: number, input: Partial<{ name: string; description: string; correspondAddress: string; disabled: boolean }>) =>
  rtRequest<RtQueue>({ method: "PUT", path: `/REST/2.0/queue/${queueId}`, body: { ...(input.name && { Name: input.name }), ...(input.description && { Description: input.description }), ...(input.correspondAddress && { CorrespondAddress: input.correspondAddress }), ...(input.disabled !== undefined && { Disabled: input.disabled ? 1 : 0 }) } });
export const disableQueue = (queueId: number) => rtRequest<RtQueue>({ method: "PUT", path: `/REST/2.0/queue/${queueId}`, body: { Disabled: 1 } });

export async function findOrCreateGmailLabelsCustomField(): Promise<RtResponse<RtCustomField>> {
  const query = new URLSearchParams({ query: JSON.stringify([{ field: "Name", value: GMAIL_LABELS_FIELD }]) });
  const found = await rtRequest<RtCollection<RtCustomField>>({ method: "GET", path: "/REST/2.0/customfields", queryParams: query });
  const existing = found.data?.items.find((field) => field.Name === GMAIL_LABELS_FIELD);
  if (found.ok && existing) return { ok: true, status: found.status, data: existing };
  if (!found.ok) return { ...found, data: null };
  return rtRequest<RtCustomField>({ method: "POST", path: "/REST/2.0/customfield", body: { Name: GMAIL_LABELS_FIELD, Type: "FreeformMultiple", LookupType: "RT::Queue-RT::Ticket", MaxValues: 0 } });
}

export const attachCustomFieldToQueue = (customFieldId: number, queueId: number) =>
  rtRequest<RtCustomField>({ method: "PUT", path: `/REST/2.0/customfield/${customFieldId}`, body: { AddTo: [`RT::Queue-${queueId}`] } });

export type RtRightsPrincipal =
  | { type: "User"; name: string }
  | { type: "Group"; name: string };

export const grantQueueRights = async (
  queueId: number,
  principal: string | RtRightsPrincipal,
  rights: string[],
) => {
  const principalBody = typeof principal === "string"
    ? { User: principal }
    : { [principal.type]: principal.name };
  for (const right of rights) {
    const result = await rtRequest<Record<string, unknown>>({
      method: "POST",
      path: `/REST/2.0/queue/${queueId}/rights`,
      body: { ...principalBody, Right: right },
    });
    if (!result.ok && result.status !== 409) return result;
  }
  return { ok: true, status: 200, data: null } as RtResponse<Record<string, unknown>>;
};

export const setTicketGmailLabels = (ticketId: number, names: string[]) =>
  rtRequest<RtTicket>({ method: "PUT", path: `/REST/2.0/ticket/${ticketId}`, body: { CustomFields: { [GMAIL_LABELS_FIELD]: names } } });

function numericResourceId(value: unknown): number | null {
  const parsed = Number(typeof value === "object" && value && "id" in value ? value.id : value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRfcMessageId(value: string): string {
  const normalized = value.trim().replace(/^<|>$/g, "");
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error("invalid_rfc_message_id");
  return normalized;
}

export async function resolveMailgateIdentity(
  rawMessageId: string,
): Promise<{ ticketId: number; transactionId: number; queueId: number } | null> {
  const messageId = normalizeRfcMessageId(rawMessageId);
  const queryParams = new URLSearchParams({
    query: JSON.stringify([{ field: "MessageId", operator: "=", value: messageId }]),
    fields: "MessageId,TransactionId,Subject",
  });
  const attachments = await rtRequest<RtCollection<RtAttachment>>({
    method: "GET",
    path: "/REST/2.0/attachments",
    queryParams,
  });
  if (!attachments.ok || !attachments.data || attachments.data.items.length !== 1) return null;
  const attachment = attachments.data.items[0];
  if (attachment.MessageId !== messageId) return null;
  const transactionId = numericResourceId(attachment.TransactionId);
  if (!transactionId) return null;

  const transaction = await rtRequest<RtTransaction>({
    method: "GET",
    path: `/REST/2.0/transaction/${transactionId}`,
    queryParams: new URLSearchParams({ fields: "Object,Type" }),
  });
  const ticketId = numericResourceId(transaction.data?.Ticket ?? transaction.data?.Object);
  if (!transaction.ok || !ticketId) return null;

  const ticket = await getTicket(ticketId);
  const queueId = numericResourceId(ticket.data?.Queue);
  if (!ticket.ok || !queueId) return null;
  return { ticketId, transactionId, queueId };
}

export async function findMailgateIdentity(input: {
  messageId: string;
  queueId: number;
}): Promise<{ ticketId: number; transactionId: number } | null> {
  if (!Number.isSafeInteger(input.queueId) || input.queueId <= 0) throw new Error("invalid_queue_id");
  const identity = await resolveMailgateIdentity(input.messageId);
  if (!identity || identity.queueId !== input.queueId) return null;
  return { ticketId: identity.ticketId, transactionId: identity.transactionId };
}
