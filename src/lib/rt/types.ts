export type AppStatus = "active" | "pending" | "closed";
export type GmailLabelState = "ACTIVE" | "PENDING_CREATE" | "PENDING_RENAME" | "PENDING_DELETE" | "FAILED";

export interface NormalizedMailbox {
  id: string;
  name: string;
  email: string;
  active: boolean;
  syncStatus: "PROVISIONING" | "ACTIVE" | "DEGRADED" | "DISABLED";
}

export interface NormalizedLabel {
  id: string;
  name: string;
  state: GmailLabelState;
}

export interface NormalizedConversation {
  id: number;
  mailboxId: string;
  number: string;
  subject: string;
  status: AppStatus;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
  labels: NormalizedLabel[];
}

export interface NormalizedAttachment {
  id: number;
  filename: string;
  size: string;
  preferences: Record<string, string>;
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
  hidden?: boolean;
  displayType?: "email" | "app_reply" | "internal" | "system";
  attachments: NormalizedAttachment[];
  createdAt: string;
}

export interface RtCollection<T> {
  count: number;
  page: number;
  pages: number;
  per_page: number;
  next_page?: string | null;
  prev_page?: string | null;
  total: number;
  items: T[];
}

export interface NormalizedPage<T> {
  items: T[];
  count: number;
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  nextPage: string | null;
  previousPage: string | null;
}

export interface RtTicket {
  id: string | number;
  Queue?: { id?: string | number; Name?: string } | string | number;
  Subject?: string;
  Status?: string;
  Created?: string;
  LastUpdated?: string;
  EffectiveId?: { id?: string | number } | string | number;
  Requestor?: Array<{ id?: string; Name?: string; EmailAddress?: string }> | { id?: string; Name?: string; EmailAddress?: string };
  CustomFields?: Array<{ id?: string | number; name?: string; values?: unknown[] }> | Record<string, unknown> | string;
  TransactionCount?: number | string;
  _hyperlinks?: Array<{ ref?: string; id?: string | number; _url?: string }>;
}

export interface RtTransaction {
  id: string | number;
  Ticket?: { id?: string | number } | string | number;
  Object?: { id?: string | number; type?: string } | string | number;
  Type?: string;
  Creator?: { id?: string; Name?: string };
  Created?: string;
  Content?: string;
  ContentType?: string;
  Subject?: string;
  From?: string;
  To?: string;
  Cc?: string;
  Attachments?: Array<{
    id: string | number;
    Filename?: string;
    ContentLength?: string | number;
    ContentType?: string;
  }> | string;
}

export interface RtQueue {
  id: string | number;
  Name?: string;
  Description?: string;
  CorrespondAddress?: string;
  Disabled?: boolean | number;
}

export interface RtCustomField {
  id: string | number;
  Name?: string;
  Type?: string;
  MaxValues?: number;
  Disabled?: boolean | number;
}

export interface RtAttachment {
  id: string | number;
  MessageId?: string;
  TransactionId?: string | number;
  Subject?: string;
}

export interface RtAttachmentDetail {
  id: string | number;
  TransactionId?: { id?: string | number } | string | number;
  Parent?: { id?: string | number } | string | number;
  MessageId?: string;
  Subject?: string;
  Filename?: string;
  ContentType?: string;
  Headers?: string;
  Content?: string | null;
}
