/** Zammad API response types used by the mailbox proxy */

import { parseEmailIdentity } from "@/lib/mailboxes/identity";

// ─── Raw Zammad API types ───────────────────────────────────────────────────

export interface ZammadGroup {
  id: number;
  name: string;
  name_last: string;
  active: boolean;
  note: string | null;
  email_address_id: number | null;
  signature_id: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Admin channel types ────────────────────────────────────────────────────

export interface ZammadInboundConfig {
  adapter: "imap";
  options: {
    host: string;
    port: string;
    ssl: string; // "ssl" | "starttls" | "false"
    user: string;
    password: string;
    folder?: string;
  };
}

export interface ZammadOutboundConfig {
  adapter: "smtp";
  options: {
    host: string;
    port: number;
    ssl: boolean;
    user: string;
    password: string;
  };
}

export interface ZammadVerifyInput {
  meta: { realname: string; email: string; password?: string };
  group_id: number;
  channel_id?: number; // present on update
  inbound: ZammadInboundConfig;
  outbound: ZammadOutboundConfig;
}

export interface ZammadConnectionTestResult {
  result: "ok" | "invalid" | "failed" | "duplicate";
  message?: string;
  message_human?: string;
  invalid_field?: Record<string, boolean>;
  source?: "inbound" | "outbound";
  // probe success fields
  setting?: {
    inbound?: ZammadInboundConfig;
    outbound?: ZammadOutboundConfig;
  };
}

export interface ZammadChannelAsset {
  id: number;
  group_id: number | null;
  area: string;
  active: boolean;
  options: Record<string, unknown>;
  status_in: string | null;
  status_out: string | null;
}

export interface ZammadChannelsEmailResponse {
  account_channel_ids: number[];
  notification_channel_ids: number[];
  email_address_ids: number[];
  assets: {
    Channel: Record<string, ZammadChannelAsset>;
  };
}

export interface ZammadTicket {
  id: number;
  group_id: number;
  priority_id: number;
  state_id: number;
  organization_id: number | null;
  number: string;
  title: string;
  owner_id: number;
  customer_id: number;
  note: string | null;
  article_count: number;
  article_ids?: number[];
  pending_time: string | null;
  created_at: string;
  updated_at: string;
  close_at: string | null;
  last_contact_at: string | null;
  last_contact_agent_at: string | null;
  last_contact_customer_at: string | null;
}

export interface ZammadArticle {
  id: number;
  ticket_id: number;
  type_id: number;
  sender_id: number;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  body: string;
  content_type: string;
  internal: boolean;
  type: string; // "note" | "email" | "web" | "phone"
  sender: string; // "Agent" | "Customer" | "System"
  attachments: ZammadAttachment[];
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface ZammadAttachment {
  id: number;
  filename: string;
  size: string;
  preferences: Record<string, string>;
}

export interface ZammadTicketState {
  id: number;
  name: string;
  state_type_id: number;
  active: boolean;
}

// ─── Normalized types returned to the UI ────────────────────────────────────

export interface NormalizedMailbox {
  id: number;
  name: string;
  active: boolean;
}

export interface NormalizedConversation {
  id: number;
  mailboxId: number; // zammad group_id
  number: string;
  subject: string; // ticket.title
  status: "active" | "pending" | "closed";
  customerId: number;
  assigneeId?: number;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
}

export interface NormalizedThread {
  id: number;
  conversationId: number;
  subject?: string;
  body: string;
  contentType: string;
  from?: string;
  to?: string;
  cc?: string;
  type: string;
  sender?: string;
  internal: boolean;
  attachments: ZammadAttachment[];
  createdAt: string;
}

export interface ConversationDetail {
  conversation: NormalizedConversation;
  threads: NormalizedThread[];
}

// ─── Status mapping helpers ─────────────────────────────────────────────────

export type AppStatus = "active" | "pending" | "closed";

/** Zammad state_id → app status */
export function stateIdToAppStatus(stateId: number): AppStatus {
  switch (stateId) {
    case 1: // new
    case 2: // open
      return "active";
    case 3: // pending reminder
      return "pending";
    case 4: // closed
      return "closed";
    default:
      return "active"; // merged (5), pending close (6) → treat as active
  }
}

/** App status → Zammad state name(s) for search */
export function appStatusToZammadSearchStates(status: AppStatus): string[] {
  switch (status) {
    case "active":
      return ["new", "open"];
    case "pending":
      return ["pending reminder"];
    case "closed":
      return ["closed"];
  }
}

/** App status → Zammad state name for update */
export function appStatusToZammadUpdateState(status: AppStatus): string {
  switch (status) {
    case "active":
      return "open";
    case "pending":
      return "pending reminder";
    case "closed":
      return "closed";
  }
}

// ─── Normalization helpers ──────────────────────────────────────────────────

export function normalizeGroup(group: ZammadGroup): NormalizedMailbox {
  return {
    id: group.id,
    name: group.name,
    active: group.active,
  };
}

export function normalizeTicket(ticket: ZammadTicket): NormalizedConversation {
  return {
    id: ticket.id,
    mailboxId: ticket.group_id,
    number: ticket.number,
    subject: ticket.title,
    status: stateIdToAppStatus(ticket.state_id),
    customerId: ticket.customer_id,
    assigneeId: ticket.owner_id !== 1 ? ticket.owner_id : undefined, // owner_id=1 is system user
    updatedAt: ticket.updated_at,
    createdAt: ticket.created_at,
    articleCount: ticket.article_count,
  };
}

export function normalizeArticle(article: ZammadArticle): NormalizedThread {
  return {
    id: article.id,
    conversationId: article.ticket_id,
    subject: article.subject ?? undefined,
    body: article.body,
    contentType: article.content_type,
    from: article.from ?? undefined,
    to: article.to ?? undefined,
    cc: article.cc ?? undefined,
    type: article.type,
    sender: article.sender ?? undefined,
    internal: article.internal,
    attachments: article.attachments ?? [],
    createdAt: article.created_at,
  };
}

export function enrichConversationIdentity(
  conversation: NormalizedConversation,
  articles: NormalizedThread[],
): NormalizedConversation {
  const source =
    articles.find((article) => {
      return !article.internal && article.type === "email" && Boolean(article.from);
    }) ?? articles.find((article) => !article.internal && Boolean(article.from));

  if (!source?.from) return conversation;

  const parsed = parseEmailIdentity(source.from);
  return {
    ...conversation,
    fromName: parsed.name || undefined,
    fromEmail: parsed.email || undefined,
  };
}
