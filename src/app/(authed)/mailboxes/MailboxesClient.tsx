"use client";

import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock3,
  Inbox,
  Mail,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Settings,
  StickyNote,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  EmailBodyRenderer,
} from "@/components/mailboxes/EmailBodyRenderer";
import { htmlToReadableText, isHtmlEmail } from "@/lib/mailboxes/email-body-renderer";
import { displayMailboxIdentity, parseEmailIdentity } from "@/lib/mailboxes/identity";

interface StoreOption {
  id: string;
  name: string;
  domain: string;
}

interface Mailbox {
  id: string;
  name: string;
  email: string;
  active: boolean;
  syncStatus?: string;
  unreadCount?: number | null;
}

interface MailboxLabel {
  id: string;
  name: string;
  type: "USER" | "INBOX" | "IMPORTANT" | "STARRED";
  mutable: boolean;
  state: string;
  conversationCount?: number;
}

interface Conversation {
  id: string;
  mailboxId: string;
  number: string;
  subject: string;
  status: "active" | "pending" | "closed";
  customerId?: number | null;
  assigneeId?: number;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
  labels?: MailboxLabel[];
  internalNotes?: InternalNotePreview[];
  responseMetric?: {
    responseStartedAt: string;
    latestAdminReplyAt: string | null;
    responseDurationMs: string | number | null;
  } | null;
  unread?: boolean;
}

interface InternalNotePreview {
  id: string;
  body: string;
  createdAt: string;
}

interface Thread {
  id: number | string;
  conversationId: string;
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
  attachments: EmailAttachment[];
  createdAt: string;
}

interface ComposerAttachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

interface EmailAttachment {
  id: number;
  filename: string;
  size?: string;
  preferences?: Record<string, string>;
}

interface PageInfo {
  size: number;
  totalElements: number;
  totalPages: number;
  number: number;
}

interface ResponseSummaryRow {
  totalConversations: number;
  repliedConversations: number;
  unrepliedConversations: number;
  overdueConversations: number;
  averageResponseDurationMs: number | null;
  oldestPendingAgeMs: number | null;
}

interface Props {
  stores: StoreOption[];
  initialSelectedStoreId?: string | null;
}

const POLL_INTERVAL = 45_000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isoDateTime(date: Date) {
  return date.toISOString();
}

function parseDateValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function dateToValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string) {
  const date = parseDateValue(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function buildCalendarDays(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export default function MailboxesClient({ stores, initialSelectedStoreId = null }: Props) {
  const router = useRouter();
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(initialSelectedStoreId);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<Mailbox | null>(null);
  const [labels, setLabels] = useState<MailboxLabel[]>([]);
  const [labelsReady, setLabelsReady] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [labelComposerOpen, setLabelComposerOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [labelSaving, setLabelSaving] = useState(false);
  const [conversationLabelIds, setConversationLabelIds] = useState<string[]>([]);
  const [conversationLabelsSaving, setConversationLabelsSaving] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadingMailboxes, setLoadingMailboxes] = useState(false);
  const [convLoading, setConvLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingConversationActionId, setPendingConversationActionId] = useState<string | null>(null);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricsFrom, setMetricsFrom] = useState(() => isoDate(new Date(Date.now() - 29 * DAY_MS)));
  const [metricsTo, setMetricsTo] = useState(() => isoDate(new Date()));
  const [metricsSummary, setMetricsSummary] = useState<ResponseSummaryRow | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const conversationPageCacheRef = useRef(
    new Map<string, { conversations: Conversation[]; page: PageInfo }>(),
  );

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );
  const inboxLabel = useMemo(
    () => labels.find((label) => label.type === "INBOX" && label.state === "ACTIVE") ?? null,
    [labels],
  );
  const effectiveSelectedLabelId = selectedLabelId ?? inboxLabel?.id ?? null;
  const selectedLabel = useMemo(
    () => labels.find((label) => label.id === effectiveSelectedLabelId) ?? null,
    [effectiveSelectedLabelId, labels],
  );
  const totalConversations = pageInfo?.totalElements ?? conversations.length;
  const mailboxUnreadCount = selectedMailbox?.unreadCount ?? null;
  const isInboxView = selectedLabel?.type === "INBOX";
  const conversationListTitle = selectedLabel?.type === "INBOX"
    ? "Inbox"
    : selectedLabel?.name ?? "All conversations";
  const readingConversation = Boolean(selectedConv);
  const inboxGridStyle = readingConversation
    ? railCollapsed ? inboxCollapsedReaderLayout : inboxReaderLayout
    : railCollapsed ? inboxCollapsedEmptyLayout : inboxEmptyLayout;
  const conversationPageCacheKey = useCallback(
    (page: number, pageSize: number) =>
      [
        selectedStoreId ?? "",
        selectedMailbox?.id ?? "",
        effectiveSelectedLabelId ?? "",
        page,
        pageSize,
      ].join(":"),
    [selectedStoreId, selectedMailbox?.id, effectiveSelectedLabelId],
  );
  const clearConversationPageCache = useCallback(() => {
    conversationPageCacheRef.current.clear();
  }, []);

  const chooseStore = (storeId: string | null) => {
    clearConversationPageCache();
    setSelectedStoreId(storeId);
    setSelectedMailbox(null);
    setLabels([]);
    setLabelsReady(false);
    setSelectedLabelId(null);
    setLabelComposerOpen(false);
    setSelectedConv(null);
    setConversationLabelIds([]);
    selectedConversationIdRef.current = null;
    setThreads([]);
    setConversations([]);
    setPageInfo(null);
    setComposerAttachments([]);
    setMetricsOpen(false);
    setMetricsSummary(null);
    setCurrentPage(1);
    router.replace(storeId ? `/mailboxes?storeId=${storeId}` : "/mailboxes");
  };

  const loadMailboxes = useCallback(async (showLoading = true) => {
    if (!selectedStoreId) {
      setMailboxes([]);
      setSelectedMailbox(null);
      return;
    }
    if (showLoading) setLoadingMailboxes(true);
    try {
      const data = await apiFetch<{ mailboxes: Mailbox[] }>(
        `/api/mailbox-proxy/mailboxes?storeId=${encodeURIComponent(selectedStoreId)}`,
      );
      const activeMailboxes = data.mailboxes.filter((mailbox) => mailbox.active);
      setMailboxes(activeMailboxes);
      setSelectedMailbox((current) => {
        if (activeMailboxes.length === 0) return null;
        if (!current) return activeMailboxes[0];
        return activeMailboxes.find((mailbox) => mailbox.id === current.id) ?? activeMailboxes[0];
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the tai mailboxes");
    } finally {
      if (showLoading) setLoadingMailboxes(false);
    }
  }, [selectedStoreId]);

  useEffect(() => {
    void loadMailboxes();
  }, [loadMailboxes]);

  const openConversation = useCallback(
    async (conv: Conversation) => {
      if (!selectedStoreId || !selectedMailbox) return;
      setDetailLoading(true);
      selectedConversationIdRef.current = conv.id;
      setSelectedConv(conv);
      setThreads([]);
      setReplyText("");
      setComposerAttachments([]);
      try {
        const data = await apiFetch<{ conversation: Conversation; threads: Thread[] }>(
          `/api/mailbox-proxy/conversations/${conv.id}?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        );
        selectedConversationIdRef.current = data.conversation?.id ?? conv.id;
        const resolvedConversation = data.conversation ?? conv;
        setSelectedConv((current) =>
          current?.id === resolvedConversation.id
            ? {
                ...resolvedConversation,
                unread: current.unread ?? resolvedConversation.unread,
              }
            : resolvedConversation,
        );
        setConversationLabelIds((resolvedConversation.labels ?? []).map((label) => label.id));
        setThreads(data.threads);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Khong the mo conversation");
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedMailbox, selectedStoreId],
  );

  const syncConversationUnreadState = useCallback((convId: string, unread: boolean) => {
    let delta = 0;
    setConversations((items) =>
      items.map((item) => {
        if (item.id !== convId) return item;
        const currentUnread = item.unread ?? false;
        if (currentUnread === unread) return item;
        delta = unread ? 1 : -1;
        return { ...item, unread };
      }),
    );
    setSelectedConv((current) =>
      current?.id === convId ? { ...current, unread } : current,
    );
    if (delta === 0) return;
    setSelectedMailbox((current) =>
      current
        ? {
            ...current,
            unreadCount:
              typeof current.unreadCount === "number"
                ? Math.max(0, current.unreadCount + delta)
                : current.unreadCount,
          }
        : current,
    );
    setMailboxes((items) =>
      items.map((item) =>
        item.id === selectedMailbox?.id
          ? {
              ...item,
              unreadCount:
                typeof item.unreadCount === "number"
                  ? Math.max(0, item.unreadCount + delta)
                  : item.unreadCount,
            }
          : item,
      ),
    );
  }, [selectedMailbox?.id]);

  const markConversationRead = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox || !conv.unread) return;
    const actionId = `read:${conv.id}`;
    if (pendingConversationActionId) return;
    setPendingConversationActionId(actionId);
    syncConversationUnreadState(conv.id, false);
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/read?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      clearConversationPageCache();
    } catch (e) {
      syncConversationUnreadState(conv.id, true);
      toast.error(e instanceof Error ? e.message : "Khong the mark email as read");
    } finally {
      setPendingConversationActionId(null);
    }
  }, [clearConversationPageCache, pendingConversationActionId, selectedMailbox, selectedStoreId, syncConversationUnreadState]);

  const markConversationUnread = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox || conv.unread) return;
    const actionId = `unread:${conv.id}`;
    if (pendingConversationActionId) return;
    setPendingConversationActionId(actionId);
    syncConversationUnreadState(conv.id, true);
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/unread?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      clearConversationPageCache();
      toast.success("Đã chuyển email sang unread");
    } catch (e) {
      syncConversationUnreadState(conv.id, false);
      toast.error(e instanceof Error ? e.message : "Khong the mark email as unread");
    } finally {
      setPendingConversationActionId(null);
    }
  }, [clearConversationPageCache, pendingConversationActionId, selectedMailbox, selectedStoreId, syncConversationUnreadState]);

  const reportConversationSpam = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox) return;
    if (!window.confirm("Report this email as spam?")) return;
    const actionId = `spam:${conv.id}`;
    if (pendingConversationActionId) return;
    setPendingConversationActionId(actionId);
    const toastId = toast.loading("Reporting spam...");
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/report-spam?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      clearConversationPageCache();
      setConversations((items) => items.filter((item) => item.id !== conv.id));
      setSelectedConv((current) => (current?.id === conv.id ? null : current));
      if (selectedConv?.id === conv.id) {
        setThreads([]);
        setReplyText("");
        setComposerAttachments([]);
      }
      setSelectedMailbox((current) =>
        current
          ? {
              ...current,
              unreadCount:
                typeof current.unreadCount === "number" && conv.unread
                  ? Math.max(0, current.unreadCount - 1)
                  : current.unreadCount,
            }
          : current,
      );
      setMailboxes((items) =>
        items.map((item) =>
          item.id === selectedMailbox.id
            ? {
                ...item,
                unreadCount:
                  typeof item.unreadCount === "number" && conv.unread
                    ? Math.max(0, item.unreadCount - 1)
                    : item.unreadCount,
              }
            : item,
        ),
      );
      setPageInfo((current) =>
        current
          ? { ...current, totalElements: Math.max(0, current.totalElements - 1) }
          : current,
      );
      toast.success("Đã report spam", { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the report spam", { id: toastId });
    } finally {
      setPendingConversationActionId(null);
    }
  }, [clearConversationPageCache, pendingConversationActionId, selectedMailbox, selectedConv?.id, selectedStoreId]);

  const deleteConversation = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox) return;
    if (!window.confirm("Move this email to Trash?")) return;
    const actionId = `delete:${conv.id}`;
    if (pendingConversationActionId) return;
    setPendingConversationActionId(actionId);
    const toastId = toast.loading("Moving to Trash...");
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/delete?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      clearConversationPageCache();
      setConversations((items) => items.filter((item) => item.id !== conv.id));
      setSelectedConv((current) => (current?.id === conv.id ? null : current));
      if (selectedConv?.id === conv.id) {
        setThreads([]);
        setReplyText("");
        setComposerAttachments([]);
      }
      setSelectedMailbox((current) =>
        current
          ? {
              ...current,
              unreadCount:
                typeof current.unreadCount === "number" && conv.unread
                  ? Math.max(0, current.unreadCount - 1)
                  : current.unreadCount,
            }
          : current,
      );
      setMailboxes((items) =>
        items.map((item) =>
          item.id === selectedMailbox.id
            ? {
                ...item,
                unreadCount:
                  typeof item.unreadCount === "number" && conv.unread
                    ? Math.max(0, item.unreadCount - 1)
                    : item.unreadCount,
              }
            : item,
        ),
      );
      setPageInfo((current) =>
        current
          ? { ...current, totalElements: Math.max(0, current.totalElements - 1) }
          : current,
      );
      toast.success("Moved to Trash", { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the delete email", { id: toastId });
    } finally {
      setPendingConversationActionId(null);
    }
  }, [clearConversationPageCache, pendingConversationActionId, selectedMailbox, selectedConv?.id, selectedStoreId]);

  const skipConversationSender = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox) return;
    const senderEmail = conv.fromEmail || displayMailboxIdentity(conv);
    if (!window.confirm(`Future emails from ${senderEmail} will go to Spam.`)) return;
    const actionId = `skip:${conv.id}`;
    if (pendingConversationActionId) return;
    setPendingConversationActionId(actionId);
    const toastId = toast.loading("Skipping sender...");
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/skip-sender?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      clearConversationPageCache();
      setConversations((items) => items.filter((item) => item.id !== conv.id));
      setSelectedConv((current) => (current?.id === conv.id ? null : current));
      if (selectedConv?.id === conv.id) {
        setThreads([]);
        setReplyText("");
        setComposerAttachments([]);
      }
      setSelectedMailbox((current) =>
        current
          ? {
              ...current,
              unreadCount:
                typeof current.unreadCount === "number" && conv.unread
                  ? Math.max(0, current.unreadCount - 1)
                  : current.unreadCount,
            }
          : current,
      );
      setMailboxes((items) =>
        items.map((item) =>
          item.id === selectedMailbox.id
            ? {
                ...item,
                unreadCount:
                  typeof item.unreadCount === "number" && conv.unread
                    ? Math.max(0, item.unreadCount - 1)
                    : item.unreadCount,
              }
            : item,
        ),
      );
      setPageInfo((current) =>
        current
          ? { ...current, totalElements: Math.max(0, current.totalElements - 1) }
          : current,
      );
      toast.success("Sender skipped", { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the skip sender", { id: toastId });
    } finally {
      setPendingConversationActionId(null);
    }
  }, [clearConversationPageCache, pendingConversationActionId, selectedMailbox, selectedConv?.id, selectedStoreId]);

  const loadConversations = useCallback(async () => {
    if (!selectedMailbox || !selectedStoreId) return;
    if (!labelsReady) return;
    if (labels.length > 0 && !effectiveSelectedLabelId) return;
    const pageSize = 25;
    const cacheKey = conversationPageCacheKey(currentPage, pageSize);
    const cached = conversationPageCacheRef.current.get(cacheKey);
    if (cached) {
      setConversations(cached.conversations);
      setPageInfo(cached.page);
    }
    setConvLoading(true);
    try {
      const qs = new URLSearchParams({
        storeId: selectedStoreId,
        mailboxId: String(selectedMailbox.id),
        page: String(currentPage),
        pageSize: String(pageSize),
      });
      if (effectiveSelectedLabelId) qs.set("labelId", effectiveSelectedLabelId);
      const data = await apiFetch<{ conversations: Conversation[]; page: PageInfo }>(
        `/api/mailbox-proxy/conversations?${qs}`,
      );
      conversationPageCacheRef.current.set(cacheKey, data);
      setConversations(data.conversations);
      setPageInfo(data.page);
      const visibleConversationIds = new Set(data.conversations.map((conversation) => conversation.id));
      const refreshedSelected = selectedConversationIdRef.current
        ? data.conversations.find((conversation) => conversation.id === selectedConversationIdRef.current) ?? null
        : null;
      selectedConversationIdRef.current = refreshedSelected?.id ?? null;
      setSelectedConv((current) => {
        if (!current) return current;
        if (!visibleConversationIds.has(current.id)) return null;
        return refreshedSelected && refreshedSelected.id === current.id
          ? { ...current, ...refreshedSelected }
          : current;
      });
      if (!refreshedSelected && selectedConversationIdRef.current === null) {
        setThreads((current) => (current.length > 0 ? [] : current));
        setConversationLabelIds((current) => (current.length > 0 ? [] : current));
        setReplyText("");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the tai conversations");
    } finally {
      setConvLoading(false);
    }
  }, [
    selectedMailbox,
    selectedStoreId,
    effectiveSelectedLabelId,
    currentPage,
    labels.length,
    labelsReady,
    conversationPageCacheKey,
  ]);

  useEffect(() => {
    clearConversationPageCache();
  }, [selectedStoreId, selectedMailbox?.id, effectiveSelectedLabelId, clearConversationPageCache]);

  useEffect(() => {
    if (!selectedStoreId || !selectedMailbox) {
      setLabels([]);
      setLabelsReady(false);
      setSelectedLabelId(null);
      return;
    }
    setLabelsReady(false);
    const qs = new URLSearchParams({ storeId: selectedStoreId, mailboxId: selectedMailbox.id });
    if (selectedLabelId) qs.set("labelId", selectedLabelId);
    apiFetch<{ labels: MailboxLabel[] }>(`/api/mailbox-proxy/labels?${qs}`)
      .then((data) => {
        setLabels(data.labels);
        const defaultInboxLabel = data.labels.find((label) => label.type === "INBOX" && label.state === "ACTIVE");
        setSelectedLabelId((current) => {
          if (current && data.labels.some((label) => label.id === current)) return current;
          return defaultInboxLabel?.id ?? null;
        });
        setLabelsReady(true);
      })
      .catch((e: Error) => {
        setLabelsReady(true);
        toast.error(e.message);
      });
  }, [selectedLabelId, selectedMailbox, selectedStoreId]);

  const chooseMailbox = (mailboxId: string) => {
    clearConversationPageCache();
    const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId) ?? null;
    setSelectedMailbox(mailbox);
    setLabelsReady(false);
    setSelectedLabelId(null);
    setSelectedConv(null);
    setConversationLabelIds([]);
    selectedConversationIdRef.current = null;
    setThreads([]);
    setConversations([]);
    setPageInfo(null);
    setMetricsSummary(null);
    setCurrentPage(1);
  };

  const loadResponseMetrics = useCallback(async (range?: { from: string; to: string }) => {
    if (!selectedStoreId || !selectedMailbox) return;
    setMetricsLoading(true);
    try {
      const fromValue = range?.from ?? metricsFrom;
      const toValue = range?.to ?? metricsTo;
      const qs = new URLSearchParams({
        storeId: selectedStoreId,
        mailboxId: selectedMailbox.id,
        from: fromValue,
        to: toValue,
      });
      const data = await apiFetch<{ summary: ResponseSummaryRow[] }>(
        `/api/mailbox-proxy/response-metrics/summary?${qs}`,
      );
      setMetricsSummary(data.summary[0] ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tải response metrics");
    } finally {
      setMetricsLoading(false);
    }
  }, [metricsFrom, metricsTo, selectedMailbox, selectedStoreId]);

  useEffect(() => {
    if (metricsOpen) void loadResponseMetrics();
  }, [loadResponseMetrics, metricsOpen]);

  const createLabel = async () => {
    if (!selectedStoreId || !selectedMailbox || !newLabelName.trim()) return;
    setLabelSaving(true);
    try {
      await apiFetch("/api/mailbox-proxy/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          mailboxId: selectedMailbox.id,
          name: newLabelName.trim(),
        }),
      });
      clearConversationPageCache();
      toast.success("Đã tạo label, đang sync sang Gmail");
      setNewLabelName("");
      setLabelComposerOpen(false);
      const qs = new URLSearchParams({ storeId: selectedStoreId, mailboxId: selectedMailbox.id });
      const data = await apiFetch<{ labels: MailboxLabel[] }>(`/api/mailbox-proxy/labels?${qs}`);
      setLabels(data.labels);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không thể tạo label");
    } finally {
      setLabelSaving(false);
    }
  };

  const refreshLabels = useCallback(async () => {
    if (!selectedStoreId || !selectedMailbox) return;
    const qs = new URLSearchParams({ storeId: selectedStoreId, mailboxId: selectedMailbox.id });
    if (selectedLabelId) qs.set("labelId", selectedLabelId);
    const data = await apiFetch<{ labels: MailboxLabel[] }>(
      `/api/mailbox-proxy/labels?${qs}`,
    );
    setLabels(data.labels);
  }, [selectedLabelId, selectedMailbox, selectedStoreId]);

  useEffect(() => {
    if (!labels.some((label) => label.state.startsWith("PENDING"))) return;
    const timer = setInterval(() => {
      void refreshLabels().catch((e: Error) => toast.error(e.message));
    }, 2_000);
    return () => clearInterval(timer);
  }, [labels, refreshLabels]);

  const renameLabel = async (label: MailboxLabel) => {
    if (!selectedStoreId || !selectedMailbox || !label.mutable) return;
    const name = window.prompt("Rename Gmail label", label.name)?.trim();
    if (!name || name === label.name) return;
    setLabelSaving(true);
    try {
      await apiFetch(`/api/mailbox-proxy/labels/${label.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, mailboxId: selectedMailbox.id, name }),
      });
      clearConversationPageCache();
      toast.success("Đang đổi tên label trên Gmail");
      await refreshLabels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không thể đổi tên label");
    } finally {
      setLabelSaving(false);
    }
  };

  const deleteLabel = async (label: MailboxLabel) => {
    if (!selectedStoreId || !selectedMailbox || !label.mutable) return;
    const affected = label.conversationCount ?? 0;
    if (!window.confirm(`Delete "${label.name}"? Label này đang gắn với ${affected} conversation.`)) return;
    setLabelSaving(true);
    try {
      const qs = new URLSearchParams({ storeId: selectedStoreId, mailboxId: selectedMailbox.id });
      await apiFetch(`/api/mailbox-proxy/labels/${label.id}?${qs}`, { method: "DELETE" });
      clearConversationPageCache();
      if (selectedLabelId === label.id) setSelectedLabelId(null);
      setConversationLabelIds((ids) => ids.filter((id) => id !== label.id));
      toast.success("Đang xóa label khỏi Gmail");
      await refreshLabels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không thể xóa label");
    } finally {
      setLabelSaving(false);
    }
  };

  const saveConversationLabels = async (
    targetConversation: Conversation | null = selectedConv,
    targetLabelIds = conversationLabelIds,
  ) => {
    if (!targetConversation || !selectedStoreId || !selectedMailbox) return;
    const assignableLabelIds = new Set(
      labels
        .filter((label) => label.type === "USER" && label.mutable && label.state === "ACTIVE")
        .map((label) => label.id),
    );
    const safeLabelIds = targetLabelIds.filter((id) => assignableLabelIds.has(id));
    setConversationLabelsSaving(true);
    try {
      const data = await apiFetch<{ state: string }>(
        `/api/mailbox-proxy/conversations/${targetConversation.id}/labels`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: selectedStoreId,
            mailboxId: selectedMailbox.id,
            labelIds: safeLabelIds,
          }),
        },
      );
      clearConversationPageCache();
      toast.success(data.state === "PENDING" ? "Đang sync labels sang Gmail" : "Labels đã được lưu");
      const nextLabels = labels.filter((label) => safeLabelIds.includes(label.id));
      setConversations((items) =>
        items.map((item) =>
          item.id === targetConversation.id ? { ...item, labels: nextLabels } : item,
        ),
      );
      setSelectedConv((current) =>
        current?.id === targetConversation.id ? { ...current, labels: nextLabels } : current,
      );
      if (selectedConv?.id === targetConversation.id) setConversationLabelIds(safeLabelIds);
      void loadConversations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không thể cập nhật labels");
    } finally {
      setConversationLabelsSaving(false);
    }
  };

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void loadConversations();
      void loadMailboxes(false);
    }, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadConversations, loadMailboxes]);

  const sendReply = async () => {
    if (!selectedConv || !replyText.trim() || !selectedStoreId || !selectedMailbox) return;
    setSending(true);
    const toastId = toast.loading("Sending reply...");
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${selectedConv.id}/threads?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: replyText.trim(),
            attachmentIds: composerAttachments.map((attachment) => attachment.id),
          }),
        },
      );
      clearConversationPageCache();
      toast.success("Da gui reply", { id: toastId });
      setReplyText("");
      setComposerAttachments([]);
      void openConversation(selectedConv);
      void loadConversations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the gui reply", { id: toastId });
    } finally {
      setSending(false);
    }
  };

  const saveInternalNote = async (text: string) => {
    if (!selectedConv || !selectedStoreId || !selectedMailbox || !text.trim()) return;
    const data = await apiFetch<{ note: Thread }>(
      `/api/mailbox-proxy/conversations/${selectedConv.id}/internal-notes?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      },
    );
    setThreads((items) => [...items, data.note]);
    const notePreview = {
      id: String(data.note.id),
      body: data.note.body,
      createdAt: data.note.createdAt,
    };
    setConversations((items) =>
      items.map((item) =>
        item.id === selectedConv.id
          ? { ...item, internalNotes: [notePreview, ...(item.internalNotes ?? [])] }
          : item,
      ),
    );
    setSelectedConv((current) =>
      current?.id === selectedConv.id
        ? { ...current, internalNotes: [notePreview, ...(current.internalNotes ?? [])] }
        : current,
    );
    toast.success("Internal note saved");
  };

  const uploadComposerAttachment = async (file: File) => {
    if (!selectedConv || !selectedStoreId || !selectedMailbox) return;
    setUploadingAttachment(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const data = await apiFetch<{ attachment: ComposerAttachment }>(
        `/api/mailbox-proxy/conversations/${selectedConv.id}/attachments?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST", body: form },
      );
      setComposerAttachments((items) => [...items, data.attachment]);
      toast.success("Attachment uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the upload attachment");
    } finally {
      setUploadingAttachment(false);
    }
  };

  return (
    <main style={pageShell}>
      <header style={topHeader}>
        <div style={headerTopRow}>
          <div>
            <h1 style={pageTitle}>Mailboxes</h1>
            <p style={pageSubtitle}>Manage support mailboxes and customer conversations</p>
          </div>
          <div style={headerActions}>
            {selectedStoreId && selectedMailbox ? (
              <button type="button" style={manageButton} onClick={() => setMetricsOpen(true)}>
                <BarChart3 size={16} /> Response metrics
              </button>
            ) : null}
            <button type="button" style={manageButtonPrimary} onClick={() => router.push("/stores")}>
              <Settings size={16} /> Manage stores
            </button>
          </div>
        </div>
        <div style={storeSwitcherRow}>
          <StoreMenu
            stores={stores}
            mailboxes={mailboxes}
            selectedStore={selectedStore}
            selectedMailbox={selectedMailbox}
            unread={mailboxUnreadCount}
            onChoose={chooseStore}
            onChooseMailbox={chooseMailbox}
          />
        </div>
      </header>

      {metricsOpen && selectedMailbox ? (
        <ResponseMetricsModal
          mailboxEmail={selectedMailbox.email}
          from={metricsFrom}
          to={metricsTo}
          summary={metricsSummary}
          loading={metricsLoading}
          onFrom={setMetricsFrom}
          onTo={setMetricsTo}
          onApply={() => loadResponseMetrics()}
          onClose={() => setMetricsOpen(false)}
        />
      ) : null}

      {!selectedStoreId ? (
        <EmptyWorkspace
          title="Choose a store to open its mailbox"
          text="Select a store from the switcher above to view active mailboxes and conversations."
        />
      ) : loadingMailboxes ? (
        <EmptyWorkspace loading title="Loading mailboxes" text="Checking store mailbox status." />
      ) : mailboxes.length === 0 ? (
        <EmptyWorkspace
          title={`Store "${selectedStore?.name ?? "selected"}" has no active mailbox`}
          text="Connect a mailbox in Mailbox Config to start receiving and replying to customer email."
          action={
            <button
              type="button"
              style={primaryButton}
              onClick={() => router.push("/admin/mailboxes")}
            >
              <Plus size={16} /> Add mailbox
            </button>
          }
        />
      ) : !selectedMailbox ? (
        <EmptyWorkspace
          loading
          title="Loading mailbox"
          text="Selecting the default mailbox for this store."
        />
      ) : (
        <>
          <section style={inboxGridStyle}>
            <FilterRail
              selectedMailbox={selectedMailbox}
              inboxUnreadCount={mailboxUnreadCount}
              labels={labels}
              selectedLabelId={effectiveSelectedLabelId}
              labelComposerOpen={labelComposerOpen}
              newLabelName={newLabelName}
              labelSaving={labelSaving}
              collapsed={railCollapsed}
              onToggleCollapsed={() => setRailCollapsed((value) => !value)}
              onLabel={(labelId) => {
                setSelectedLabelId(labelId);
                setCurrentPage(1);
                setSelectedConv(null);
                selectedConversationIdRef.current = null;
                setThreads([]);
              }}
              onOpenLabelComposer={() => setLabelComposerOpen(true)}
              onCloseLabelComposer={() => {
                setLabelComposerOpen(false);
                setNewLabelName("");
              }}
              onNewLabelName={setNewLabelName}
              onCreateLabel={() => void createLabel()}
              onRenameLabel={(label) => void renameLabel(label)}
              onDeleteLabel={(label) => void deleteLabel(label)}
            />

            {!selectedConv ? (
              <ConversationList
                conversations={conversations}
                selectedId={null}
                title={conversationListTitle}
                total={isInboxView ? null : totalConversations}
                loading={convLoading}
                currentPage={currentPage}
                pageInfo={pageInfo}
                labels={labels}
                labelsSaving={conversationLabelsSaving}
                pendingActionId={pendingConversationActionId}
                onOpen={(conversation) => {
                  void (async () => {
                    await openConversation(
                      conversation.unread ? { ...conversation, unread: false } : conversation,
                    );
                    if (conversation.unread) await markConversationRead(conversation);
                  })();
                }}
                onSaveLabels={(conversation, labelIds) => void saveConversationLabels(conversation, labelIds)}
                onMarkRead={(conversation) => void markConversationRead(conversation)}
                onMarkUnread={(conversation) => void markConversationUnread(conversation)}
                onReportSpam={(conversation) => void reportConversationSpam(conversation)}
                onDelete={(conversation) => void deleteConversation(conversation)}
                onSkipSender={(conversation) => void skipConversationSender(conversation)}
                onRefresh={() => void loadConversations()}
                onPage={setCurrentPage}
              />
            ) : null}

            {selectedConv ? (
              <ConversationDetail
                conversation={selectedConv}
                threads={threads}
                loading={detailLoading}
                labels={labels}
                replyText={replyText}
                sending={sending}
                composerAttachments={composerAttachments}
                uploadingAttachment={uploadingAttachment}
                selectedLabelIds={conversationLabelIds}
                labelsSaving={conversationLabelsSaving}
                onReplyText={setReplyText}
                onSend={() => void sendReply()}
                onSaveInternalNote={(text) => void saveInternalNote(text)}
                onUploadAttachment={(file) => void uploadComposerAttachment(file)}
                onRemoveAttachment={(attachmentId) => {
                  setComposerAttachments((items) => items.filter((attachment) => attachment.id !== attachmentId));
                }}
                onMarkUnread={() => {
                  if (selectedConv) void markConversationUnread(selectedConv);
                }}
                onReportSpam={() => {
                  if (selectedConv) void reportConversationSpam(selectedConv);
                }}
                onToggleLabel={(labelId) => {
                  setConversationLabelIds((ids) =>
                    ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId],
                  );
                }}
                onSaveLabels={() => void saveConversationLabels()}
                onBack={() => {
                  setSelectedConv(null);
                  selectedConversationIdRef.current = null;
                  setThreads([]);
                }}
              />
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}

function MailboxSelect({
  mailboxes,
  selectedMailbox,
  onChoose,
}: {
  mailboxes: Mailbox[];
  selectedMailbox: Mailbox | null;
  onChoose: (mailboxId: string) => void;
}) {
  return (
    <select
      value={selectedMailbox?.id ?? ""}
      onChange={(event) => onChoose(event.target.value)}
      style={mailboxSelect}
      aria-label="Choose mailbox"
    >
      {mailboxes.map((mailbox) => (
        <option key={mailbox.id} value={mailbox.id}>
          {mailbox.email}
        </option>
      ))}
    </select>
  );
}

function StoreMenu({
  stores,
  mailboxes,
  selectedStore,
  selectedMailbox,
  unread,
  onChoose,
  onChooseMailbox,
}: {
  stores: StoreOption[];
  mailboxes: Mailbox[];
  selectedStore: StoreOption | null;
  selectedMailbox: Mailbox | null;
  unread: number | null;
  onChoose: (storeId: string | null) => void;
  onChooseMailbox: (mailboxId: string) => void;
}) {
  return (
    <div style={storeMenu}>
      <div style={storeAvatar}>{initials(selectedStore?.name ?? "TU")}</div>
      <select
        aria-label="Choose store"
        value={selectedStore?.id ?? ""}
        onChange={(event) => onChoose(event.target.value || null)}
        style={storeSelect}
      >
        <option value="">Choose store</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
      {mailboxes.length > 0 ? (
        <MailboxSelect
          mailboxes={mailboxes}
          selectedMailbox={selectedMailbox}
          onChoose={onChooseMailbox}
        />
      ) : null}
      <span style={activePill}>{selectedMailbox?.email ?? "No mailbox"}</span>
      <span style={unreadBlock}>
        <strong>{unread ?? "—"}</strong>
        <span>unread</span>
      </span>
      <ChevronDown size={16} color="#475467" />
    </div>
  );
}

function ResponseMetricsModal({
  mailboxEmail,
  from,
  to,
  summary,
  loading,
  onFrom,
  onTo,
  onApply,
  onClose,
}: {
  mailboxEmail: string;
  from: string;
  to: string;
  summary: ResponseSummaryRow | null;
  loading: boolean;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onApply: (range?: { from: string; to: string }) => void;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<"24h" | "7d" | "30d" | "custom">("custom");
  const applyPreset = (nextPreset: "24h" | "7d" | "30d") => {
    const duration = nextPreset === "24h" ? DAY_MS : nextPreset === "7d" ? 7 * DAY_MS : 30 * DAY_MS;
    const now = new Date();
    const nextFromDate = new Date(now.getTime() - duration);
    const nextFrom = isoDate(nextFromDate);
    const nextTo = isoDate(now);
    onFrom(nextFrom);
    onTo(nextTo);
    setPreset(nextPreset);
    onApply({ from: isoDateTime(nextFromDate), to: isoDateTime(now) });
  };
  return (
    <div style={modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        style={metricsModal}
        role="dialog"
        aria-modal="true"
        aria-label="Response metrics"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={metricsModalHeader}>
          <div>
            <h2 style={metricsModalTitle}>Response metrics</h2>
            <p style={metricsModalSubtitle}>{mailboxEmail}</p>
          </div>
          <button type="button" style={modalCloseButton} onClick={onClose} aria-label="Close response metrics">
            <X size={18} />
          </button>
        </div>

        <div style={rangeSection}>
          <span style={rangeLabel}>Select time range</span>
          <div style={rangeButtons}>
            <button type="button" style={preset === "24h" ? rangeButtonActive : rangeButton} onClick={() => applyPreset("24h")}>
              Last 24 hours
            </button>
            <button type="button" style={preset === "7d" ? rangeButtonActive : rangeButton} onClick={() => applyPreset("7d")}>
              Last 7 days
            </button>
            <button type="button" style={preset === "30d" ? rangeButtonActive : rangeButton} onClick={() => applyPreset("30d")}>
              Last 30 days
            </button>
            <button type="button" style={preset === "custom" ? rangeButtonActive : rangeButton} onClick={() => setPreset("custom")}>
              Custom <CalendarDays size={14} />
            </button>
          </div>
        </div>

        {preset === "custom" ? (
          <div style={metricsFilters}>
            <label style={fieldLabel}>
              From
              <DatePickerField value={from} onChange={onFrom} />
            </label>
            <label style={fieldLabel}>
              To
              <DatePickerField value={to} onChange={onTo} />
            </label>
            <button type="button" style={applyButton} disabled={loading} onClick={() => onApply()}>
              <RefreshCw size={16} /> {loading ? "Loading" : "Apply"}
            </button>
          </div>
        ) : null}

        <div style={metricsGrid}>
          <MetricCard label="Over 24h" value={summary?.overdueConversations ?? 0} caption="conversations breaching SLA" />
          <MetricCard label="Avg response time" value={formatDuration(summary?.averageResponseDurationMs)} caption="only conversations with replies" tone="green" />
          <MetricCard label="Oldest pending" value={formatDuration(summary?.oldestPendingAgeMs)} caption="customer waiting longest" />
        </div>

        <div style={metricsBreakdown}>
          <MetricLine label="Total conversations" value={summary?.totalConversations ?? 0} />
          <MetricLine label="Replied conversations" value={summary?.repliedConversations ?? 0} />
          <MetricLine label="Pending conversations" value={summary?.unrepliedConversations ?? 0} />
          <MetricLine label="SLA breached" value={summary?.overdueConversations ?? 0} />
        </div>
      </section>
    </div>
  );
}

function DatePickerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [monthDate, setMonthDate] = useState(() => parseDateValue(value));
  const days = buildCalendarDays(monthDate);

  function moveMonth(delta: number) {
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1));
  }

  function selectDate(date: Date) {
    onChange(dateToValue(date));
    setMonthDate(date);
    setOpen(false);
  }

  return (
    <div style={datePickerWrap}>
      <button type="button" style={datePickerButton} onClick={() => setOpen((value) => !value)}>
        <span>{formatDateLabel(value)}</span>
        <CalendarDays size={15} />
      </button>
      {open ? (
        <div style={datePickerPopover}>
          <div style={datePickerHeader}>
            <button type="button" style={datePickerNavButton} onClick={() => moveMonth(-1)}>Prev</button>
            <strong>{monthDate.toLocaleString(undefined, { month: "long", year: "numeric" })}</strong>
            <button type="button" style={datePickerNavButton} onClick={() => moveMonth(1)}>Next</button>
          </div>
          <div style={datePickerGrid}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={`${day}-${index}`} style={datePickerWeekday}>{day}</span>
            ))}
            {days.map((day) => {
              const dayValue = dateToValue(day);
              const selected = dayValue === value;
              const muted = day.getMonth() !== monthDate.getMonth();
              return (
                <button
                  key={dayValue}
                  type="button"
                  style={{
                    ...datePickerDay,
                    ...(selected ? datePickerDaySelected : {}),
                    ...(muted ? datePickerDayMuted : {}),
                  }}
                  onClick={() => selectDate(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  caption,
  tone = "gray",
}: {
  label: string;
  value: string | number;
  caption: string;
  tone?: "gray" | "green";
}) {
  return (
    <div style={metricCard}>
      <Clock3 size={17} color={tone === "green" ? "#22c55e" : "#64748b"} style={metricIcon} />
      <span style={metricLabel}>{label}</span>
      <strong style={metricValue}>{value}</strong>
      <small style={metricCaption}>{caption}</small>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: number }) {
  return (
    <div style={metricLine}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterRail({
  selectedMailbox,
  inboxUnreadCount,
  labels,
  selectedLabelId,
  labelComposerOpen,
  newLabelName,
  labelSaving,
  collapsed,
  onToggleCollapsed,
  onLabel,
  onOpenLabelComposer,
  onCloseLabelComposer,
  onNewLabelName,
  onCreateLabel,
  onRenameLabel,
  onDeleteLabel,
}: {
  selectedMailbox: Mailbox;
  inboxUnreadCount: number | null;
  labels: MailboxLabel[];
  selectedLabelId: string | null;
  labelComposerOpen: boolean;
  newLabelName: string;
  labelSaving: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onLabel: (labelId: string | null) => void;
  onOpenLabelComposer: () => void;
  onCloseLabelComposer: () => void;
  onNewLabelName: (value: string) => void;
  onCreateLabel: () => void;
  onRenameLabel: (label: MailboxLabel) => void;
  onDeleteLabel: (label: MailboxLabel) => void;
}) {
  const inboxLabel = labels.find((label) => label.type === "INBOX" && label.state === "ACTIVE") ?? null;
  const userLabels = labels.filter((label) => label.type === "USER" && label.name !== "[Gmail]");

  if (collapsed) {
    return (
      <aside style={railPanelCollapsed}>
        <button
          type="button"
          style={railCollapseButton}
          onClick={onToggleCollapsed}
          aria-label="Expand mailbox filters"
        >
          <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button type="button" style={railIconButton} title={selectedMailbox.email}>
          <Mail size={16} />
        </button>
        <button
          type="button"
          style={{
            ...railIconButton,
            ...(selectedLabelId === inboxLabel?.id ? railIconButtonActive : {}),
          }}
          title="Inbox"
          onClick={inboxLabel ? () => onLabel(inboxLabel.id) : undefined}
        >
          <Inbox size={16} />
        </button>
        {userLabels.map((label) => (
          <button
            key={label.id}
            type="button"
            disabled={label.state !== "ACTIVE"}
            style={{
              ...railDotButton,
              ...(selectedLabelId === label.id ? railIconButtonActive : {}),
            }}
            title={label.name}
            onClick={label.state === "ACTIVE" ? () => onLabel(label.id) : undefined}
          >
            <span style={labelTreeDot} />
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside style={railPanel}>
      <RailHeader
        title="Mailbox"
        action={
          <button
            type="button"
            style={railHeaderButton}
            onClick={onToggleCollapsed}
            aria-label="Collapse mailbox filters"
          >
            <ArrowLeft size={15} />
          </button>
        }
      />
      <button
        type="button"
        style={{ ...smallButton, width: "calc(100% - 16px)", margin: "0 8px 14px", justifyContent: "flex-start" }}
      >
        <Mail size={14} /> {selectedMailbox.email}
      </button>
      <RailHeader title="Views" />
      <RailButton
        active={selectedLabelId === inboxLabel?.id}
        dot="#2563eb"
        label="Inbox"
        count={inboxUnreadCount ?? undefined}
        onClick={inboxLabel ? () => onLabel(inboxLabel.id) : undefined}
      />
      <RailHeader title="Response labels" />
      {userLabels.map((label) => (
        <LabelListRow
          key={label.id}
          label={label}
          selectedLabelId={selectedLabelId}
          labelSaving={labelSaving}
          onLabel={onLabel}
          onRenameLabel={onRenameLabel}
          onDeleteLabel={onDeleteLabel}
        />
      ))}
      {labelComposerOpen ? (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <input
            autoFocus
            value={newLabelName}
            onChange={(event) => onNewLabelName(event.target.value)}
            placeholder="Label name"
            style={{ ...replyTextarea, minHeight: 34, height: 34, padding: "0.45rem 0.6rem" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={labelSaving || !newLabelName.trim()}
              onClick={onCreateLabel}
              style={smallButton}
            >
              {labelSaving ? "Creating..." : "Create"}
            </button>
            <button type="button" disabled={labelSaving} onClick={onCloseLabelComposer} style={smallButton}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <span style={{ color: "#98a2b3", fontSize: 15 }}>New label</span>
          <button type="button" onClick={onOpenLabelComposer} style={iconButton} aria-label="Create label">
            <Plus size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}

function LabelListRow({
  label,
  selectedLabelId,
  labelSaving,
  onLabel,
  onRenameLabel,
  onDeleteLabel,
}: {
  label: MailboxLabel;
  selectedLabelId: string | null;
  labelSaving: boolean;
  onLabel: (labelId: string | null) => void;
  onRenameLabel: (label: MailboxLabel) => void;
  onDeleteLabel: (label: MailboxLabel) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = selectedLabelId === label.id;
  const text = label.state === "ACTIVE" ? label.name : `${label.name} (${label.state.toLowerCase()})`;
  const count = label.conversationCount;

  return (
      <div style={labelTreeRow}>
        <button
          type="button"
          disabled={label.state !== "ACTIVE"}
          onClick={label.state === "ACTIVE" ? () => onLabel(label.id) : undefined}
          style={{ ...labelTreeButton, ...(active ? activeLabelTreeButton : {}) }}
        >
          <span style={labelTreeDot} />
          <span style={labelTreeText}>{text}</span>
          {typeof count === "number" ? <span style={labelTreeCount}>{count}</span> : null}
        </button>
        {label?.mutable && (
          <div style={labelTreeActions}>
            <button
              type="button"
              disabled={labelSaving}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((value) => !value);
              }}
              style={labelTreeActionButton}
              aria-label={`Open actions for ${label.name}`}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen ? (
              <div style={labelTreeActionMenu}>
                <button
                  type="button"
                  disabled={labelSaving}
                  style={labelTreeMenuButton}
                  onClick={() => {
                    setMenuOpen(false);
                    onRenameLabel(label);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={labelSaving}
                  style={{ ...labelTreeMenuButton, color: "#b42318" }}
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteLabel(label);
                  }}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
  );
}

function ConversationList({
  conversations,
  selectedId,
  title,
  total,
  loading,
  currentPage,
  pageInfo,
  labels,
  labelsSaving,
  pendingActionId,
  onOpen,
  onSaveLabels,
  onMarkRead,
  onMarkUnread,
  onReportSpam,
  onDelete,
  onSkipSender,
  onRefresh,
  onPage,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  title: string;
  total: number | null;
  loading: boolean;
  currentPage: number;
  pageInfo: PageInfo | null;
  labels: MailboxLabel[];
  labelsSaving: boolean;
  pendingActionId: string | null;
  onOpen: (conversation: Conversation) => void;
  onSaveLabels: (conversation: Conversation, labelIds: string[]) => void;
  onMarkRead: (conversation: Conversation) => void;
  onMarkUnread: (conversation: Conversation) => void;
  onReportSpam: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
  onSkipSender: (conversation: Conversation) => void;
  onRefresh: () => void;
  onPage: (page: number) => void;
}) {
  const [openLabelMenuConversationId, setOpenLabelMenuConversationId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkLabelMenuOpen, setBulkLabelMenuOpen] = useState(false);
  const [bulkLabelIds, setBulkLabelIds] = useState<string[]>([]);
  const selectedConversations = conversations.filter((conversation) => bulkSelectedIds.includes(conversation.id));
  const allVisibleSelected = conversations.length > 0 && conversations.every((conversation) => bulkSelectedIds.includes(conversation.id));
  const bulkUserLabels = labels.filter(
    (label) => label.type === "USER" && label.mutable && label.state === "ACTIVE" && !label.name.startsWith("[Gmail]"),
  );

  useEffect(() => {
    const visibleIds = new Set(conversations.map((conversation) => conversation.id));
    setBulkSelectedIds((ids) => ids.filter((id) => visibleIds.has(id)));
  }, [conversations]);

  const toggleBulkConversation = (conversationId: string) => {
    setBulkSelectedIds((ids) =>
      ids.includes(conversationId)
        ? ids.filter((id) => id !== conversationId)
        : [...ids, conversationId],
    );
  };

  const applyBulkLabels = () => {
    for (const conversation of selectedConversations) {
      const currentUserLabelIds = (conversation.labels ?? [])
        .filter((label) => label.type === "USER" && label.mutable && label.state === "ACTIVE")
        .map((label) => label.id);
      onSaveLabels(conversation, [...new Set([...currentUserLabelIds, ...bulkLabelIds])]);
    }
    setBulkLabelIds([]);
    setBulkLabelMenuOpen(false);
  };

  const toggleAllVisible = () => {
    setBulkSelectedIds(allVisibleSelected ? [] : conversations.map((conversation) => conversation.id));
  };

  return (
    <section style={listPanel}>
      <div style={listToolbar}>
        <div style={listTitleBlock}>
          <strong>{title}</strong>
          {typeof total === "number" ? <span style={smallCount}>{total}</span> : null}
        </div>
        <div style={toolbarButtons}>
          <label style={selectAllLabel}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={conversations.length === 0}
              onChange={toggleAllVisible}
              style={checkboxStyle}
            />
            Select all
          </label>
          <button type="button" style={iconButton} onClick={onRefresh} title="Refresh">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {bulkSelectedIds.length > 0 ? (
        <div style={bulkToolbar}>
          <strong>{bulkSelectedIds.length} selected</strong>
          <button type="button" style={bulkActionButton} onClick={() => selectedConversations.forEach(onMarkRead)}>
            Mark read
          </button>
          <button type="button" style={bulkActionButton} onClick={() => selectedConversations.forEach(onMarkUnread)}>
            Mark unread
          </button>
          <button
            type="button"
            style={{ ...bulkActionButton, color: "#b42318" }}
            onClick={() => selectedConversations.forEach(onReportSpam)}
          >
            Report spam
          </button>
          <button
            type="button"
            style={{ ...bulkActionButton, color: "#b42318" }}
            onClick={() => selectedConversations.forEach(onDelete)}
          >
            Delete
          </button>
          <div style={bulkLabelWrap}>
            <button
              type="button"
              style={bulkActionButton}
              onClick={() => setBulkLabelMenuOpen((value) => !value)}
            >
              Label
            </button>
            {bulkLabelMenuOpen ? (
              <div style={bulkLabelMenu}>
                {bulkUserLabels.map((label) => (
                  <label key={label.id} style={labelMenuOption}>
                    <input
                      type="checkbox"
                      checked={bulkLabelIds.includes(label.id)}
                      disabled={labelsSaving}
                      onChange={() => {
                        setBulkLabelIds((ids) =>
                          ids.includes(label.id)
                            ? ids.filter((id) => id !== label.id)
                            : [...ids, label.id],
                        );
                      }}
                    />
                    <span>{label.name}</span>
                  </label>
                ))}
                <div style={labelMenuFooter}>
                  <button
                    type="button"
                    style={smallButton}
                    disabled={labelsSaving || bulkLabelIds.length === 0}
                    onClick={applyBulkLabels}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={conversationScroller}>
        {loading && conversations.length === 0 ? (
          <CenteredSpinner />
        ) : conversations.length === 0 ? (
          <EmptyInline text="No conversations in this view." />
        ) : (
          conversations.map((conversation, index) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              selected={conversation.id === selectedId}
              index={index}
              labels={labels}
              labelsSaving={labelsSaving}
              pendingActionId={pendingActionId}
              menuOpen={openLabelMenuConversationId === conversation.id}
              bulkSelected={bulkSelectedIds.includes(conversation.id)}
              onClick={() => onOpen(conversation)}
              onToggleBulk={() => toggleBulkConversation(conversation.id)}
              onOpenMenu={() => setOpenLabelMenuConversationId(conversation.id)}
              onCloseMenu={() => setOpenLabelMenuConversationId(null)}
              onSaveLabels={(labelIds) => onSaveLabels(conversation, labelIds)}
              onMarkRead={() => onMarkRead(conversation)}
              onMarkUnread={() => onMarkUnread(conversation)}
              onReportSpam={() => onReportSpam(conversation)}
              onDelete={() => onDelete(conversation)}
              onSkipSender={() => onSkipSender(conversation)}
            />
          ))
        )}
      </div>

      {pageInfo && pageInfo.totalPages > 1 && (
        <div style={pager}>
          <span style={pagerSummary}>
            Showing {((currentPage - 1) * pageInfo.size) + 1} to {Math.min(currentPage * pageInfo.size, pageInfo.totalElements)} of {pageInfo.totalElements} conversations
          </span>
          <button
            type="button"
            style={pagerButton}
            disabled={currentPage <= 1}
            onClick={() => onPage(currentPage - 1)}
          >
            <ArrowLeft size={16} />
          </button>
          <span style={pagerCurrent}>
            {currentPage}
          </span>
          <button
            type="button"
            style={pagerButton}
            disabled={currentPage >= pageInfo.totalPages}
            onClick={() => onPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

function ConversationRow({
  conversation,
  selected,
  index,
  labels,
  labelsSaving,
  pendingActionId,
  menuOpen,
  bulkSelected,
  onClick,
  onToggleBulk,
  onOpenMenu,
  onCloseMenu,
  onSaveLabels,
  onMarkRead,
  onMarkUnread,
  onReportSpam,
  onDelete,
  onSkipSender,
}: {
  conversation: Conversation;
  selected: boolean;
  index: number;
  labels: MailboxLabel[];
  labelsSaving: boolean;
  pendingActionId: string | null;
  menuOpen: boolean;
  bulkSelected: boolean;
  onClick: () => void;
  onToggleBulk: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onSaveLabels: (labelIds: string[]) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onReportSpam: () => void;
  onDelete: () => void;
  onSkipSender: () => void;
}) {
  const [labelQuery, setLabelQuery] = useState("");
  const [draftLabelIds, setDraftLabelIds] = useState<string[]>([]);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const contactName = displayMailboxIdentity(conversation);
  const rowLabels = conversation.labels ?? [];
  const rowInternalNotes = conversation.internalNotes ?? [];
  const displayLabels = rowLabels.filter((label) => label.type === "USER" && label.state === "ACTIVE");
  const visibleLabels = displayLabels.slice(0, 2);
  const hiddenLabelCount = Math.max(0, displayLabels.length - visibleLabels.length);
  const unread = conversation.unread ?? false;
  const messageCount = conversation.articleCount;
  const assignableLabelIds = new Set(
    labels
      .filter((label) => label.type === "USER" && label.mutable && label.state === "ACTIVE")
      .map((label) => label.id),
  );
  const filteredUserLabels = labels.filter((label) => {
    const query = labelQuery.trim().toLocaleLowerCase("en-US");
    return label.type === "USER"
      && label.mutable
      && label.state === "ACTIVE"
      && !label.name.startsWith("[Gmail]")
      && (!query || label.name.toLocaleLowerCase("en-US").includes(query));
  });
  const menuLeft = menuPosition ? Math.max(8, Math.min(menuPosition.x, window.innerWidth - 312)) : 8;
  const menuTop = menuPosition ? Math.max(8, Math.min(menuPosition.y, window.innerHeight - 420)) : 8;
  const actionPending = pendingActionId?.endsWith(`:${conversation.id}`) ?? false;
  const responseAge = conversation.responseMetric?.latestAdminReplyAt
    ? conversation.responseMetric.responseDurationMs
    : null;
  const responseOverdue = responseAge != null && Number(responseAge) > 24 * 60 * 60 * 1000;
  const statusLabel = unread ? "New" : conversation.status === "closed" ? "Closed" : null;

  const openLabelMenu = (x: number, y: number) => {
    setDraftLabelIds(rowLabels.map((label) => label.id).filter((id) => assignableLabelIds.has(id)));
    setLabelQuery("");
    setMenuPosition({ x, y });
    onOpenMenu();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onClick();
        openLabelMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        ...conversationRow,
        background: selected ? "#eef9e9" : unread ? "#fbfff8" : "#fff",
        borderLeft: selected || unread ? "3px solid #84cc16" : "3px solid transparent",
        position: "relative",
      }}
    >
      <input
        type="checkbox"
        checked={bulkSelected}
        aria-label={`Select ${conversation.subject || contactName}`}
        onClick={(event) => event.stopPropagation()}
        onChange={onToggleBulk}
        style={checkboxStyle}
      />
      <Avatar label={contactName} index={index} />
      <div style={rowBody}>
        <div style={rowTop}>
          <div style={rowIdentity}>
            {unread ? <span style={unreadDot} /> : null}
            <strong style={{ ...truncate, fontWeight: unread ? 900 : 600, color: unread ? "#101828" : "#344054" }}>
              {contactName}
            </strong>
          </div>
        </div>
        <div style={{ ...rowSubject, fontWeight: unread ? 800 : 500, color: unread ? "#101828" : "#667085" }}>
          {conversation.subject || "(no subject)"}
        </div>
        <div style={rowMeta}>
          {messageCount > 1 ? (
            <span style={messageCountBadge} title={`${messageCount} messages`}>
              <Mail size={13} />
              {messageCount}
            </span>
          ) : null}
          {visibleLabels.map((label) => (
            <span key={label.id} style={neutralBadge}>{label.name}</span>
          ))}
          {hiddenLabelCount > 0 ? <span style={neutralBadge}>+{hiddenLabelCount}</span> : null}
          {rowInternalNotes.length > 0 ? (
            <span style={rowNoteWrap}>
              <button
                type="button"
                style={rowNoteButton}
                aria-label={`${rowInternalNotes.length} internal notes`}
                onClick={(event) => {
                  event.stopPropagation();
                  setNotesOpen((value) => !value);
                }}
              >
                <StickyNote size={14} />
                {rowInternalNotes.length}
              </button>
              {notesOpen ? (
                <div style={rowNotePopover} onClick={(event) => event.stopPropagation()}>
                  {rowInternalNotes.map((note) => (
                    <div key={note.id} style={rowNoteItem}>
                      <div style={internalNoteMeta}>{formatTime(note.createdAt)}</div>
                      <div style={internalNoteBody}>{note.body}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      <div style={rowSide}>
        {statusLabel ? <span style={unread ? statusBadgeNew : neutralBadge}>{statusLabel}</span> : null}
        <span style={{ ...timeText, color: unread ? "#101828" : "#667085", fontWeight: unread ? 800 : 600 }}>
          {formatTime(conversation.updatedAt)}
        </span>
        {responseAge != null ? (
          <span style={responseOverdue ? responseTimeBadgeDanger : responseTimeBadge}>
            <Clock3 size={13} />
            {formatDuration(responseAge)}
          </span>
        ) : null}
      </div>
      {menuOpen ? (
        <div
          style={{ ...rowLabelMenu, left: menuLeft, top: menuTop }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div style={gmailMenuHeader}>
            <span>Actions</span>
            <button
              type="button"
              style={menuCloseButton}
              aria-label="Close label menu"
              onClick={onCloseMenu}
            >
              ×
            </button>
          </div>
          <div style={labelMenuActions}>
            {unread ? (
              <button
                type="button"
                style={actionMenuButton}
                disabled={actionPending}
                onClick={() => {
                  onMarkRead();
                  onCloseMenu();
                }}
              >
                {pendingActionId === `read:${conversation.id}` ? "Marking..." : "Mark as read"}
              </button>
            ) : (
              <button
                type="button"
                style={actionMenuButton}
                disabled={actionPending}
                onClick={() => {
                  onMarkUnread();
                  onCloseMenu();
                }}
              >
                {pendingActionId === `unread:${conversation.id}` ? "Marking..." : "Mark as unread"}
              </button>
            )}
            <button
              type="button"
              style={{ ...actionMenuButton, color: "#b42318" }}
              disabled={actionPending}
              onClick={() => {
                onReportSpam();
                onCloseMenu();
              }}
            >
              {pendingActionId === `spam:${conversation.id}` ? "Reporting..." : "Report spam"}
            </button>
            <button
              type="button"
              style={actionMenuButton}
              disabled={actionPending}
              onClick={() => {
                onSkipSender();
                onCloseMenu();
              }}
            >
              {pendingActionId === `skip:${conversation.id}` ? "Skipping..." : "Skip sender"}
            </button>
            <button
              type="button"
              style={{ ...actionMenuButton, color: "#b42318" }}
              disabled={actionPending}
              onClick={() => {
                onDelete();
                onCloseMenu();
              }}
            >
              {pendingActionId === `delete:${conversation.id}` ? "Deleting..." : "Delete"}
            </button>
          </div>
          <div style={labelMenuDivider} />
          <div style={labelSearchRow}>
            <input
              autoFocus
              value={labelQuery}
              onChange={(event) => setLabelQuery(event.target.value)}
              placeholder="Search labels"
              style={labelSearchInput}
            />
          </div>
          <div style={labelMenuList}>
            {filteredUserLabels.map((label) => (
              <label key={label.id} style={labelMenuOption}>
                <input
                  type="checkbox"
                  checked={draftLabelIds.includes(label.id)}
                  disabled={labelsSaving}
                  onChange={() => {
                    setDraftLabelIds((ids) =>
                      ids.includes(label.id)
                        ? ids.filter((id) => id !== label.id)
                        : [...ids, label.id],
                    );
                  }}
                />
                <span>{label.name}</span>
              </label>
            ))}
            {filteredUserLabels.length === 0 ? (
              <div style={labelMenuEmpty}>No matching labels</div>
            ) : null}
          </div>
          <div style={labelMenuFooter}>
            <button
              type="button"
              style={smallButton}
              disabled={labelsSaving}
              onClick={() => {
                onSaveLabels(draftLabelIds.filter((id) => assignableLabelIds.has(id)));
                onCloseMenu();
              }}
            >
              {labelsSaving ? "Saving..." : "Apply"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConversationDetail({
  conversation,
  threads,
  loading,
  labels,
  replyText,
  sending,
  composerAttachments,
  uploadingAttachment,
  selectedLabelIds,
  labelsSaving,
  onReplyText,
  onSend,
  onSaveInternalNote,
  onUploadAttachment,
  onRemoveAttachment,
  onMarkUnread,
  onReportSpam,
  onToggleLabel,
  onSaveLabels,
  onBack,
}: {
  conversation: Conversation;
  threads: Thread[];
  loading: boolean;
  labels: MailboxLabel[];
  replyText: string;
  sending: boolean;
  composerAttachments: ComposerAttachment[];
  uploadingAttachment: boolean;
  selectedLabelIds: string[];
  labelsSaving: boolean;
  onReplyText: (value: string) => void;
  onSend: () => void;
  onSaveInternalNote: (text: string) => void;
  onUploadAttachment: (file: File) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onMarkUnread: () => void;
  onReportSpam: () => void;
  onToggleLabel: (labelId: string) => void;
  onSaveLabels: () => void;
  onBack: () => void;
}) {
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [labelQuery, setLabelQuery] = useState("");
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [internalNoteText, setInternalNoteText] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [expandedThreadIds, setExpandedThreadIds] = useState<string[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setLabelMenuOpen(false);
    setLabelQuery("");
    setComposerMode("reply");
    setInternalNoteText("");
    setNotesOpen(false);
    setExpandedThreadIds([]);
  }, [conversation?.id]);
  useEffect(() => {
    const latestThread = [...threads].reverse().find((thread) => !thread.hidden && thread.displayType !== "internal");
    if (latestThread) setExpandedThreadIds([String(latestThread.id)]);
  }, [conversation?.id, threads]);

  if (loading) {
    return (
      <section style={detailPanel}>
        <DetailState
          loading
          title="Loading conversation"
          text="Fetching the email body and thread history."
        />
      </section>
    );
  }

  const internalNotes = threads.filter((thread) => !thread.hidden && thread.displayType === "internal");
  const internalNoteCount = internalNotes.length;
  const visibleThreads = threads.filter((thread) => !thread.hidden && thread.displayType !== "internal");
  const firstThread = visibleThreads.find((thread) => thread.displayType !== "internal" && (thread.from || thread.sender))
    ?? visibleThreads.find((thread) => thread.from || thread.sender)
    ?? visibleThreads[0]
    ?? threads[0];
  const hasLoadedBody = visibleThreads.length > 0;
  const sender = parseEmailIdentity(firstThread?.from || firstThread?.sender);
  const detailContactName = sender.name || displayMailboxIdentity(conversation);
  const detailDate = firstThread?.createdAt ?? conversation.updatedAt;
  const detailSubject = firstThread?.subject || conversation.subject || "(no subject)";
  const conversationLabels = conversation.labels ?? [];
  const displayLabelChips = conversationLabels.filter((label) => label.type === "USER" && label.state === "ACTIVE");
  const visibleLabelChips = displayLabelChips.slice(0, 2);
  const hiddenLabelCount = Math.max(0, displayLabelChips.length - visibleLabelChips.length);
  const filteredUserLabels = labels.filter((label) =>
    label.type === "USER"
    && label.state === "ACTIVE"
    && label.name.toLocaleLowerCase("en-US").includes(labelQuery.trim().toLocaleLowerCase("en-US")),
  );

  return (
    <section style={detailPanel}>
      <header style={detailHeader}>
        <button type="button" style={readerBackButton} onClick={onBack} aria-label="Back to mailbox">
          <ArrowLeft size={18} />
        </button>
        <Avatar label={detailContactName} index={0} large />
        <div style={{ minWidth: 0 }}>
          <h2 style={detailName}>{detailContactName}</h2>
          <div style={detailSubjectLine}>{detailSubject}</div>
          <div style={detailDateLine}>{formatTime(detailDate)}</div>
          <div style={detailTags}>
            {visibleLabelChips.map((label) => (
              <span key={label.id} style={neutralBadge}>{label.name}</span>
            ))}
            {hiddenLabelCount > 0 ? <span style={neutralBadge}>+{hiddenLabelCount} more</span> : null}
            {internalNoteCount > 0 ? (
              <button
                type="button"
                style={internalNoteBadge}
                onClick={() => setNotesOpen((value) => !value)}
              >
                {internalNoteCount} internal note
              </button>
            ) : null}
          </div>
          {notesOpen ? (
            <div style={internalNotesPanel}>
              {internalNotes.map((note) => (
                <div key={note.id} style={internalNoteItem}>
                  <div style={internalNoteMeta}>{formatTime(note.createdAt)}</div>
                  <div style={internalNoteBody}>{note.body}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ ...messageMenuWrap, marginLeft: "auto" }}>
          <button
            type="button"
            style={iconButton}
            onClick={() => setLabelMenuOpen((value) => !value)}
            aria-label="Conversation actions"
          >
            <MoreHorizontal size={17} />
          </button>
          {labelMenuOpen ? (
            <div style={{ ...messageMenu, top: 42, minWidth: 320, padding: 0 }}>
              <div style={labelMenuPanel}>
                <div style={labelMenuTitle}>Actions</div>
                <div style={labelMenuList}>
                  <button
                    type="button"
                    style={actionMenuButton}
                    onClick={() => {
                      onMarkUnread();
                      setLabelMenuOpen(false);
                    }}
                  >
                    Mark as unread
                  </button>
                  <button
                    type="button"
                    style={{ ...actionMenuButton, color: "#b42318" }}
                    onClick={() => {
                      onReportSpam();
                      setLabelMenuOpen(false);
                    }}
                  >
                    Report spam
                  </button>
                </div>
                <div style={labelMenuDivider} />
                <div style={labelMenuTitle}>Label as</div>
                <div style={labelSearchRow}>
                  <input
                    value={labelQuery}
                    onChange={(event) => setLabelQuery(event.target.value)}
                    placeholder="Search labels"
                    style={labelSearchInput}
                  />
                </div>
                <div style={labelMenuList}>
                  {filteredUserLabels.map((label) => (
                    <label key={label.id} style={labelMenuOption}>
                      <input
                        type="checkbox"
                        checked={selectedLabelIds.includes(label.id)}
                        disabled={labelsSaving}
                        onChange={() => onToggleLabel(label.id)}
                      />
                      <span>{label.name}</span>
                    </label>
                  ))}
                  {filteredUserLabels.length === 0 ? (
                    <div style={labelMenuEmpty}>No matching labels</div>
                  ) : null}
                </div>
                <div style={labelMenuFooter}>
                  <button
                    type="button"
                    style={smallButton}
                    disabled={labelsSaving}
                    onClick={() => {
                      void onSaveLabels();
                      setLabelMenuOpen(false);
                    }}
                  >
                    {labelsSaving ? "Saving..." : "Save labels"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div style={detailBody}>
        <div style={threadAreaReader}>
          {hasLoadedBody ? (
            visibleThreads.map((thread, index) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                fallbackSubject={index === 0 ? conversation.subject : undefined}
                expanded={expandedThreadIds.includes(String(thread.id))}
                onToggle={() => {
                  const threadId = String(thread.id);
                  setExpandedThreadIds((ids) =>
                    ids.includes(threadId)
                      ? ids.filter((id) => id !== threadId)
                      : [...ids, threadId],
                  );
                }}
              />
            ))
          ) : (
            <DetailState
              title="Email body not loaded"
              text="This conversation does not have a readable email body yet."
            />
          )}
        </div>
      </div>

      {hasLoadedBody ? (
        <div style={composer}>
          <div style={composerTabs}>
            <button
              type="button"
              style={composerMode === "reply" ? activeTab : inactiveTab}
              onClick={() => setComposerMode("reply")}
            >
              Reply
            </button>
            <button
              type="button"
              style={composerMode === "note" ? activeTab : inactiveTab}
              onClick={() => setComposerMode("note")}
            >
              Internal note
            </button>
          </div>
          <textarea
            value={composerMode === "reply" ? replyText : internalNoteText}
            onChange={(event) => {
              if (composerMode === "reply") onReplyText(event.target.value);
              else setInternalNoteText(event.target.value);
            }}
            placeholder={composerMode === "reply" ? "Write your reply..." : "Write an internal note..."}
            rows={4}
            style={replyTextarea}
          />
          {composerAttachments.length > 0 ? (
            <div style={composerAttachmentList}>
              {composerAttachments.map((attachment) => (
                <span key={attachment.id} style={attachmentChip}>
                  <Paperclip size={13} />
                  {attachment.filename}
                  <button
                    type="button"
                    style={attachmentRemoveButton}
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() => onRemoveAttachment(attachment.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div style={composerFooter}>
            <div style={composerTools}>
              <input
                ref={attachmentInputRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  if (file) onUploadAttachment(file);
                }}
              />
              <button
                type="button"
                style={squareTool}
                title="Attachments"
                disabled={uploadingAttachment || composerMode !== "reply"}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <Paperclip size={16} />
              </button>
            </div>
            <div style={composerActions}>
              {composerMode === "reply" ? (
                <button
                  type="button"
                  style={primaryButton}
                  disabled={sending || !replyText.trim()}
                  onClick={onSend}
                >
                  <Send size={15} /> {sending ? "Sending..." : "Reply"}
                </button>
              ) : (
                <button
                  type="button"
                  style={primaryButton}
                  disabled={!internalNoteText.trim()}
                  onClick={() => {
                    onSaveInternalNote(internalNoteText);
                    setInternalNoteText("");
                  }}
                >
                  Save note
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ThreadCard({
  thread,
  fallbackSubject,
  expanded,
  onToggle,
}: {
  thread: Thread;
  fallbackSubject?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isAdminReply = thread.displayType === "app_reply";
  const isInternalNote = thread.displayType === "internal";
  const isCustomerEmail = !isAdminReply && !isInternalNote;
  const sender = parseEmailIdentity(thread.from || thread.sender);
  const senderLabel = sender.name && sender.name !== sender.email
    ? sender.name
    : isAdminReply
      ? "Admin"
      : "Customer";
  const messageTitle = isAdminReply
    ? "Admin reply"
    : isInternalNote
      ? "Internal note"
      : "Customer email";
  const isHtmlThread = isHtmlEmail(thread.contentType, thread.body);
  const realAttachments = thread.attachments.filter((attachment) => {
    const filename = attachment.filename.toLowerCase();
    return filename !== "message.html" && filename !== "message.htm";
  });
  const summary = summarizeEmailBody(thread.body, thread.contentType);

  return (
    <div style={threadBubbleRow}>
      {isCustomerEmail ? <Avatar label={senderLabel} variant="customer" /> : null}
      <article
        style={{
          ...gmailThreadCard,
          ...(isHtmlThread ? htmlThreadCard : {}),
          ...(isAdminReply ? adminThreadCard : {}),
          ...(isInternalNote ? internalThreadCard : {}),
        }}
      >
      <div
        style={{
          ...emailHeader,
          ...(isAdminReply ? adminEmailHeader : {}),
          ...(isInternalNote ? internalEmailHeader : {}),
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div style={emailHeaderTop}>
          <div style={threadMetaBlock}>
            <div style={threadTitleLine}>
              <span style={{
                ...threadTypeBadge,
                ...(isAdminReply ? adminThreadTypeBadge : {}),
                ...(isInternalNote ? internalThreadTypeBadge : {}),
              }}>
                {messageTitle}
              </span>
              <span style={threadTimeText}>{formatTime(thread.createdAt)}</span>
            </div>
            {isInternalNote ? (
              <div style={threadMetaLine}>
                <span style={internalOnlyBadge}>Internal only</span>
              </div>
            ) : null}
            {!isInternalNote && (thread.subject || fallbackSubject) ? (
              <div style={threadSubjectMeta}>{thread.subject || fallbackSubject}</div>
            ) : null}
          </div>
        </div>
      </div>
      {expanded ? (
        <EmailBodyRenderer
          body={thread.body}
          contentType={thread.contentType}
          compact
        />
      ) : (
        <button type="button" style={threadSummaryButton} onClick={onToggle}>
          {summary}
        </button>
      )}
      {expanded && realAttachments.length > 0 ? (
        <div style={attachmentList}>
          {realAttachments.map((attachment) => (
            <span key={attachment.id} style={attachmentChip}>
              <Paperclip size={13} /> {attachment.filename}
            </span>
          ))}
        </div>
      ) : null}
      </article>
      {isAdminReply ? <Avatar label={senderLabel} variant="admin" /> : null}
    </div>
  );
}

function summarizeEmailBody(body: string, contentType: string): string {
  const text = (isHtmlEmail(contentType, body) ? htmlToReadableText(body) : body).replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 180)}...` : text || "(no preview)";
}

function RailHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={railHeader}>
      <span>{title}</span>
      {action ?? null}
    </div>
  );
}

function RailButton({
  label,
  count,
  icon,
  dot,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  icon?: React.ReactNode;
  dot?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...railButton,
        background: active ? "#eef9e9" : "transparent",
        color: active ? "#2f7d32" : "#344054",
      }}
    >
      {icon}
      {dot && <span style={{ ...dotStyle, background: dot }} />}
      <span>{label}</span>
      {typeof count === "number" && <span style={railCount}>{count}</span>}
    </button>
  );
}

function EmptyWorkspace({
  title,
  text,
  action,
  loading,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <section style={emptyWorkspace}>
      {loading ? <RefreshCw size={34} className="animate-spin" /> : <Mail size={46} />}
      <h2 style={emptyTitle}>{title}</h2>
      <p style={emptyText}>{text}</p>
      {action}
    </section>
  );
}

function EmptyInline({ text }: { text: string }) {
  return (
    <div style={emptyInline}>
      <Inbox size={30} />
      <p>{text}</p>
    </div>
  );
}

function DetailState({ title, text, loading }: { title: string; text: string; loading?: boolean }) {
  return (
    <div style={detailState}>
      {loading ? <RefreshCw size={28} className="animate-spin" /> : <Mail size={34} />}
      <h3 style={detailStateTitle}>{title}</h3>
      <p style={detailStateText}>{text}</p>
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div style={emptyInline}>
      <RefreshCw size={26} className="animate-spin" />
    </div>
  );
}

function Avatar({
  label,
  index = 0,
  large = false,
  variant,
}: {
  label: string;
  index?: number;
  large?: boolean;
  variant?: "customer" | "admin" | "mailbox";
}) {
  const colors = ["#f7d7c4", "#d7f3dc", "#dbeafe", "#fde68a"];
  const background = variant === "admin"
    ? "#dbeafe"
    : variant === "customer"
      ? "#d7f3dc"
      : colors[index % colors.length];
  return (
    <span
      style={{
        ...avatar,
        width: large ? 46 : 38,
        height: large ? 46 : 38,
        background,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", sameYear
    ? {
        month: "short",
        day: "numeric",
      }
    : {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function formatDuration(valueMs: number | string | null | undefined) {
  if (valueMs == null) return "—";
  const ms = typeof valueMs === "string" ? Number(valueMs) : valueMs;
  if (!Number.isFinite(ms)) return "—";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function ageSince(value: string) {
  const started = new Date(value).getTime();
  return Number.isFinite(started) ? Math.max(0, Date.now() - started) : null;
}

const pageShell: React.CSSProperties = {
  height: "calc(100vh - 64px)",
  width: "100%",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 18,
  overflow: "hidden",
  background: "#f8faf7",
  padding: "24px 26px 26px",
};

const topHeader: React.CSSProperties = {
  display: "grid",
  gap: 18,
  minWidth: 0,
};

const headerTopRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  minWidth: 0,
};

const storeSwitcherRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  minWidth: 0,
};

const pageTitle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 34,
  lineHeight: 1.12,
  fontWeight: 900,
  letterSpacing: 0,
};

const pageSubtitle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#475467",
  fontSize: 15,
  fontWeight: 700,
};

const headerActions: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  justifyContent: "flex-end",
  minWidth: 0,
  marginLeft: "auto",
};

const storeMenu: React.CSSProperties = {
  height: 56,
  width: "min(720px, 100%)",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 14px",
  background: "#fff",
  border: "1px solid #d8dee8",
  borderRadius: 12,
  boxShadow: "0 8px 20px rgba(16, 24, 40, 0.06)",
};

const storeAvatar: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  background: "#101828",
  color: "#fff",
  fontSize: 13,
  fontWeight: 900,
};

const storeSelect: React.CSSProperties = {
  border: 0,
  outline: 0,
  background: "transparent",
  minWidth: 120,
  maxWidth: 170,
  fontWeight: 900,
  color: "#101828",
  fontSize: 15,
};

const mailboxSelect: React.CSSProperties = {
  ...storeSelect,
  minWidth: 180,
  maxWidth: 260,
};

const activePill: React.CSSProperties = {
  border: "1px solid #bbf7d0",
  background: "#ecfdf3",
  color: "#15803d",
  borderRadius: 999,
  padding: "4px 9px",
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const unreadBlock: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid #bbf7d0",
  background: "#dcfce7",
  color: "#15803d",
  borderRadius: 999,
  padding: "5px 10px",
  fontSize: 12,
  lineHeight: 1,
  fontWeight: 900,
};

const manageButton: React.CSSProperties = {
  height: 44,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  padding: "0 14px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "#101828",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(16, 24, 40, 0.04)",
};

const manageButtonPrimary: React.CSSProperties = {
  ...manageButton,
  borderColor: "#84cc16",
  background: "#8bd35d",
  color: "#17310f",
};

const inboxLayout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "230px minmax(360px, 0.78fr) minmax(0, 1.22fr)",
  gap: 16,
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
};

const inboxEmptyLayout: React.CSSProperties = {
  ...inboxLayout,
  gridTemplateColumns: "260px minmax(0, 1fr)",
};

const inboxReaderLayout: React.CSSProperties = {
  ...inboxLayout,
  gridTemplateColumns: "260px minmax(0, 1fr)",
};

const inboxCollapsedEmptyLayout: React.CSSProperties = {
  ...inboxLayout,
  gridTemplateColumns: "56px minmax(0, 1fr)",
};

const inboxCollapsedReaderLayout: React.CSSProperties = {
  ...inboxLayout,
  gridTemplateColumns: "56px minmax(0, 1fr)",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "rgba(15, 23, 42, 0.32)",
  display: "grid",
  placeItems: "center",
  padding: 20,
};

const metricsModal: React.CSSProperties = {
  width: "min(900px, 100%)",
  border: "1px solid #d8dee8",
  borderRadius: 16,
  background: "#fff",
  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.26)",
  padding: 22,
  display: "grid",
  gap: 16,
};

const metricsModalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const metricsModalTitle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 24,
  lineHeight: 1.15,
  fontWeight: 950,
};

const metricsModalSubtitle: React.CSSProperties = {
  margin: "5px 0 0",
  color: "#56637a",
  fontSize: 13,
  fontWeight: 800,
};

const modalCloseButton: React.CSSProperties = {
  width: 34,
  height: 34,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  color: "#101828",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const rangeSection: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const rangeLabel: React.CSSProperties = {
  color: "#26364d",
  fontSize: 13,
  fontWeight: 800,
};

const rangeButtons: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const rangeButton: React.CSSProperties = {
  minHeight: 38,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  color: "#101828",
  padding: "0 14px",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const rangeButtonActive: React.CSSProperties = {
  ...rangeButton,
  borderColor: "#bbf7d0",
  background: "#dcfce7",
  color: "#166534",
};

const metricsFilters: React.CSSProperties = {
  display: "flex",
  alignItems: "end",
  gap: 10,
  flexWrap: "wrap",
};

const fieldLabel: React.CSSProperties = {
  display: "grid",
  gap: 6,
  color: "#475467",
  fontSize: 12,
  fontWeight: 900,
};

const datePickerWrap: React.CSSProperties = {
  position: "relative",
};

const datePickerButton: React.CSSProperties = {
  height: 40,
  minWidth: 150,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  color: "#111827",
  padding: "0 10px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  fontWeight: 800,
  cursor: "pointer",
};

const datePickerPopover: React.CSSProperties = {
  position: "absolute",
  zIndex: 70,
  top: "calc(100% + 6px)",
  left: 0,
  width: 280,
  padding: 12,
  border: "1px solid #d8dee8",
  borderRadius: 12,
  background: "#fff",
  boxShadow: "0 16px 40px rgba(15,23,42,0.18)",
};

const datePickerHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 10,
  color: "#101828",
  fontSize: 13,
};

const datePickerNavButton: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  color: "#344054",
  padding: "0 9px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const datePickerGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: 4,
};

const datePickerWeekday: React.CSSProperties = {
  textAlign: "center",
  color: "#667085",
  fontSize: 11,
  fontWeight: 800,
  padding: "4px 0",
};

const datePickerDay: React.CSSProperties = {
  height: 32,
  border: "1px solid transparent",
  borderRadius: 8,
  background: "transparent",
  color: "#101828",
  fontWeight: 700,
  cursor: "pointer",
};

const datePickerDaySelected: React.CSSProperties = {
  borderColor: "#bbf7d0",
  background: "#dcfce7",
  color: "#166534",
  fontWeight: 900,
};

const datePickerDayMuted: React.CSSProperties = {
  color: "#98a2b3",
};

const applyButton: React.CSSProperties = {
  height: 40,
  border: 0,
  borderRadius: 8,
  background: "#6ac64a",
  color: "#12320f",
  padding: "0 18px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  fontWeight: 900,
  cursor: "pointer",
};

const metricsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const metricCard: React.CSSProperties = {
  border: "1px solid #d9e2ec",
  borderRadius: 12,
  padding: "18px 20px",
  background: "#fff",
  display: "grid",
  gap: 6,
  minWidth: 0,
  position: "relative",
  boxShadow: "0 2px 6px rgba(16, 24, 40, 0.06)",
};

const metricIcon: React.CSSProperties = {
  position: "absolute",
  right: 16,
  top: 16,
};

const metricLabel: React.CSSProperties = {
  color: "#26364d",
  fontSize: 14,
  fontWeight: 900,
};

const metricValue: React.CSSProperties = {
  color: "#111827",
  fontSize: 30,
  lineHeight: 1,
  fontWeight: 950,
};

const metricCaption: React.CSSProperties = {
  color: "#56637a",
  fontSize: 12,
  fontWeight: 800,
};

const metricsBreakdown: React.CSSProperties = {
  border: "1px solid #edf0f2",
  borderRadius: 12,
  overflow: "hidden",
  background: "#fff",
};

const metricLine: React.CSSProperties = {
  minHeight: 44,
  padding: "0 14px",
  borderBottom: "1px solid #edf0f2",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  color: "#26364d",
  fontSize: 14,
  fontWeight: 800,
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #d8dee8",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 8px 24px rgba(16, 24, 40, 0.05)",
  minWidth: 0,
  minHeight: 0,
};

const railPanel: React.CSSProperties = {
  ...panel,
  overflow: "auto",
  paddingBottom: 16,
};

const railPanelCollapsed: React.CSSProperties = {
  ...panel,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  padding: "10px 8px",
};

const listPanel: React.CSSProperties = {
  ...panel,
  display: "flex",
  flexDirection: "column",
};

const railHeader: React.CSSProperties = {
  minHeight: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 16px",
  color: "#344054",
  fontSize: 12,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const railAction: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const railHeaderButton: React.CSSProperties = {
  ...railAction,
  color: "#475467",
};

const railCollapseButton: React.CSSProperties = {
  ...railHeaderButton,
  width: 36,
  height: 36,
};

const railIconButton: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  color: "#344054",
  cursor: "pointer",
};

const railIconButtonActive: React.CSSProperties = {
  background: "#eef9e9",
  borderColor: "#d7efcd",
  color: "#2f7d32",
};

const railDotButton: React.CSSProperties = {
  ...railIconButton,
};

const railButton: React.CSSProperties = {
  width: "calc(100% - 16px)",
  margin: "0 8px 3px",
  minHeight: 42,
  border: 0,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 10px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const railCount: React.CSSProperties = {
  marginLeft: "auto",
  color: "#475467",
  fontSize: 13,
  fontWeight: 800,
};

const labelTreeRow: React.CSSProperties = {
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 30px",
  alignItems: "center",
  gap: 4,
  paddingRight: 8,
};

const labelTreeButton: React.CSSProperties = {
  minWidth: 0,
  minHeight: 30,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  display: "grid",
  gridTemplateColumns: "8px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "0 8px",
  color: "#344054",
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
};

const activeLabelTreeButton: React.CSSProperties = {
  background: "#eef9e9",
  color: "#2f7d32",
};

const labelTreeDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "#7c3aed",
};

const labelTreeText: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const labelTreeCount: React.CSSProperties = {
  minWidth: 18,
  color: "#475467",
  fontSize: 13,
  fontWeight: 900,
  textAlign: "right",
};

const labelTreeActions: React.CSSProperties = {
  position: "relative",
  display: "flex",
  justifyContent: "flex-end",
};

const labelTreeActionButton: React.CSSProperties = {
  width: 26,
  height: 26,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  background: "#fff",
  color: "#475467",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const labelTreeActionMenu: React.CSSProperties = {
  position: "absolute",
  top: 30,
  right: 0,
  zIndex: 70,
  minWidth: 120,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "0 12px 26px rgba(16, 24, 40, 0.16)",
  padding: 6,
};

const labelTreeMenuButton: React.CSSProperties = {
  width: "100%",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  padding: "8px 10px",
  color: "#101828",
  fontSize: 13,
  fontWeight: 800,
  textAlign: "left",
  cursor: "pointer",
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
};

const listToolbar: React.CSSProperties = {
  height: 70,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "0 18px",
  borderBottom: "1px solid #edf0f2",
};

const listTitleBlock: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#101828",
  fontSize: 15,
};

const smallCount: React.CSSProperties = {
  minWidth: 24,
  height: 22,
  borderRadius: 999,
  background: "#eef2f6",
  display: "grid",
  placeItems: "center",
  color: "#475467",
  fontSize: 12,
  fontWeight: 800,
};

const toolbarButtons: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const selectAllLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  color: "#475467",
  fontSize: 13,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const bulkToolbar: React.CSSProperties = {
  minHeight: 46,
  borderTop: "1px solid #edf0f2",
  borderBottom: "1px solid #edf0f2",
  background: "#f8fafc",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  color: "#101828",
  fontSize: 13,
};

const bulkActionButton: React.CSSProperties = {
  minHeight: 32,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  background: "#fff",
  color: "#344054",
  padding: "0 10px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const bulkLabelWrap: React.CSSProperties = {
  position: "relative",
};

const bulkLabelMenu: React.CSSProperties = {
  position: "absolute",
  top: 38,
  left: 0,
  zIndex: 45,
  width: 280,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "0 16px 34px rgba(16, 24, 40, 0.16)",
  overflow: "hidden",
};

const smallButton: React.CSSProperties = {
  minHeight: 36,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  background: "#fff",
  padding: "0 12px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  color: "#101828",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const iconButton: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  background: "#fff",
  display: "inline-grid",
  placeItems: "center",
  color: "#101828",
  cursor: "pointer",
};

const conversationScroller: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
};

const conversationRow: React.CSSProperties = {
  width: "100%",
  minHeight: 84,
  border: 0,
  borderBottom: "1px solid #edf0f2",
  display: "grid",
  gridTemplateColumns: "20px 40px minmax(0, 1fr) 96px",
  gap: 12,
  padding: "12px 14px",
  textAlign: "left",
  cursor: "pointer",
  alignItems: "start",
};

const rowLabelMenu: React.CSSProperties = {
  position: "fixed",
  zIndex: 60,
  width: 300,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "0 18px 40px rgba(16, 24, 40, 0.18)",
  overflow: "hidden",
};

const gmailMenuHeader: React.CSSProperties = {
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
  color: "#101828",
  fontSize: 14,
  fontWeight: 800,
  borderBottom: "1px solid #edf0f2",
};

const menuCloseButton: React.CSSProperties = {
  marginLeft: "auto",
  width: 28,
  height: 28,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "#667085",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
};

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  margin: "7px 0 0",
  cursor: "pointer",
  borderRadius: 4,
  border: "1px solid #cbd5e1",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: 12,
  fontWeight: 900,
  flexShrink: 0,
};

const avatar: React.CSSProperties = {
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  color: "#101828",
  fontWeight: 900,
  fontSize: 14,
  flex: "0 0 auto",
};

const rowBody: React.CSSProperties = {
  minWidth: 0,
  alignSelf: "center",
};

const rowTop: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};

const rowIdentity: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const truncate: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const unreadDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "#2563eb",
  flex: "0 0 auto",
};

const timeText: React.CSSProperties = {
  color: "#475467",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const rowSubject: React.CSSProperties = {
  marginTop: 8,
  color: "#101828",
  fontSize: 14,
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowSnippet: React.CSSProperties = {
  marginTop: 5,
  color: "#475467",
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowMeta: React.CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "center",
  marginTop: 10,
  flexWrap: "wrap",
};

const rowSide: React.CSSProperties = {
  display: "grid",
  justifyItems: "end",
  alignContent: "start",
  gap: 10,
  minWidth: 0,
};

const storeBadge: React.CSSProperties = {
  border: "1px solid #d7efcd",
  background: "#eef9e9",
  color: "#2f7d32",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 12,
  fontWeight: 800,
};

const neutralBadge: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  color: "#475467",
  borderRadius: 999,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 800,
};

const statusBadgeNew: React.CSSProperties = {
  ...neutralBadge,
  borderColor: "#ede9fe",
  background: "#f3e8ff",
  color: "#6d28d9",
};

const messageCountBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minWidth: 26,
  height: 22,
  padding: "0 7px",
  borderRadius: 8,
  background: "#eef2ff",
  color: "#3730a3",
  fontSize: 12,
  fontWeight: 700,
};

const responseTimeBadge: React.CSSProperties = {
  border: "1px solid #bbf7d0",
  background: "#ecfdf3",
  color: "#047857",
  borderRadius: 999,
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 900,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const responseTimeBadgeDanger: React.CSSProperties = {
  ...responseTimeBadge,
  borderColor: "#fee2e2",
  background: "#fff1f2",
  color: "#dc2626",
};

const rowNoteWrap: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
};

const rowNoteButton: React.CSSProperties = {
  border: "1px solid #f2d36b",
  borderRadius: 6,
  background: "#fff7d6",
  color: "#92400e",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minHeight: 24,
  padding: "0 7px",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
};

const rowNotePopover: React.CSSProperties = {
  position: "absolute",
  top: 30,
  left: 0,
  zIndex: 55,
  width: 280,
  border: "1px solid #f2d36b",
  borderRadius: 8,
  background: "#fffbeb",
  boxShadow: "0 16px 34px rgba(16, 24, 40, 0.16)",
  overflow: "hidden",
};

const rowNoteItem: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #fde68a",
};

const internalNoteBadge: React.CSSProperties = {
  ...neutralBadge,
  background: "#fff7d6",
  borderColor: "#f2d36b",
  color: "#92400e",
  cursor: "pointer",
};

const internalNotesPanel: React.CSSProperties = {
  marginTop: 10,
  maxWidth: 520,
  border: "1px solid #f2d36b",
  borderRadius: 8,
  background: "#fffbeb",
  overflow: "hidden",
};

const internalNoteItem: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #fde68a",
};

const internalNoteMeta: React.CSSProperties = {
  marginBottom: 4,
  color: "#92400e",
  fontSize: 12,
  fontWeight: 800,
};

const internalNoteBody: React.CSSProperties = {
  color: "#101828",
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const detailPanel: React.CSSProperties = {
  ...panel,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};

const detailHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 14,
  padding: "20px 22px 16px",
  borderBottom: "1px solid #edf0f2",
  flex: "0 0 auto",
  background: "#fff",
  zIndex: 3,
};

const readerBackButton: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "1px solid #d8dee8",
  borderRadius: 999,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  color: "#475467",
  cursor: "pointer",
  flex: "0 0 auto",
};

const detailName: React.CSSProperties = {
  margin: 0,
  color: "#101828",
  fontSize: 18,
  fontWeight: 900,
};

const detailSubjectLine: React.CSSProperties = {
  marginTop: 8,
  color: "#101828",
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.4,
};

const detailDateLine: React.CSSProperties = {
  marginTop: 2,
  color: "#667085",
  fontSize: 12,
  fontWeight: 500,
};

const detailTags: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  marginTop: 8,
  flexWrap: "wrap",
};

const detailBody: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  background: "#f4f7f9",
  minWidth: 0,
};

const threadArea: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 14,
  padding: "20px 20px 22px",
  minWidth: 0,
};

const threadAreaReader: React.CSSProperties = {
  ...threadArea,
  maxWidth: 1240,
  width: "100%",
  margin: "0 auto",
  padding: "28px 32px 34px",
};

const threadBubbleRow: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  minWidth: 0,
};

const gmailThreadCard: React.CSSProperties = {
  width: "100%",
  maxWidth: "min(100%, 1180px)",
  border: "1px solid #d8dee8",
  borderRadius: 12,
  padding: 0,
  background: "#fff",
  overflow: "hidden",
  boxShadow: "0 2px 8px rgba(16, 24, 40, 0.10)",
  minWidth: 0,
};

const htmlThreadCard: React.CSSProperties = {
  width: "100%",
  maxWidth: "min(100%, 1180px)",
};

const adminThreadCard: React.CSSProperties = {
  background: "#e8f2ff",
  borderColor: "#bfd7ff",
};

const internalThreadCard: React.CSSProperties = {
  maxWidth: "min(100%, 1180px)",
  background: "#fff7d6",
  borderColor: "#f2d36b",
};

const emailHeader: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: "10px 12px 8px",
  background: "#fff",
  borderBottom: "1px solid #edf0f2",
};

const adminEmailHeader: React.CSSProperties = {
  background: "#e8f2ff",
  borderBottomColor: "#d5e6ff",
};

const internalEmailHeader: React.CSSProperties = {
  background: "#fff7d6",
  borderBottomColor: "#f2d36b",
};

const emailHeaderTop: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const threadMetaLine: React.CSSProperties = {
  color: "#475467",
  fontSize: 12,
  fontWeight: 700,
  minWidth: 0,
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
};

const threadMetaBlock: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const threadTitleLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const threadTypeBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 22,
  borderRadius: 999,
  padding: "0 8px",
  background: "#f2f4f7",
  color: "#344054",
  fontSize: 12,
  fontWeight: 900,
};

const adminThreadTypeBadge: React.CSSProperties = {
  background: "#dbeafe",
  color: "#1d4ed8",
};

const internalThreadTypeBadge: React.CSSProperties = {
  background: "#fef3c7",
  color: "#92400e",
};

const internalOnlyBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 20,
  borderRadius: 999,
  padding: "0 7px",
  background: "#fef3c7",
  color: "#92400e",
  fontSize: 11,
  fontWeight: 900,
};

const threadTimeText: React.CSSProperties = {
  color: "#667085",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const threadSubjectMeta: React.CSSProperties = {
  color: "#101828",
  fontSize: 12,
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const threadSummaryButton: React.CSSProperties = {
  width: "100%",
  border: 0,
  borderTop: "1px solid #edf0f2",
  background: "transparent",
  padding: "10px 12px 12px",
  color: "#667085",
  fontSize: 13,
  lineHeight: 1.45,
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const emailHeaderGrid: React.CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
  flex: 1,
};

const emailHeaderRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px minmax(0, 1fr)",
  gap: 10,
  color: "#344054",
  fontSize: 13,
};

const messageMenuWrap: React.CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
};

const messageMenu: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  zIndex: 30,
  minWidth: 190,
  maxWidth: "min(320px, calc(100vw - 40px))",
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "0 16px 34px rgba(16, 24, 40, 0.16)",
  padding: 6,
};

const labelMenuPanel: React.CSSProperties = {
  display: "grid",
  gap: 0,
};

const labelMenuTitle: React.CSSProperties = {
  padding: "12px 14px 8px",
  fontSize: 13,
  fontWeight: 800,
  color: "#344054",
};

const actionMenuButton: React.CSSProperties = {
  width: "100%",
  border: 0,
  background: "transparent",
  padding: "8px 10px",
  borderRadius: 8,
  textAlign: "left",
  fontSize: 14,
  fontWeight: 700,
  color: "#101828",
  cursor: "pointer",
};

const labelMenuDivider: React.CSSProperties = {
  height: 1,
  background: "#edf0f2",
};

const labelMenuActions: React.CSSProperties = {
  padding: "6px 8px",
  display: "grid",
  gap: 2,
};

const labelSearchRow: React.CSSProperties = {
  padding: "0 12px 10px",
  borderBottom: "1px solid #edf0f2",
};

const labelSearchInput: React.CSSProperties = {
  width: "100%",
  height: 36,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  padding: "0 10px",
  outline: "none",
  fontSize: 13,
};

const labelMenuList: React.CSSProperties = {
  maxHeight: 260,
  overflow: "auto",
  padding: "8px 8px 4px",
  display: "grid",
  gap: 4,
};

const labelMenuOption: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 8,
  fontSize: 14,
  color: "#101828",
  cursor: "pointer",
};

const labelMenuEmpty: React.CSSProperties = {
  padding: "10px 12px",
  color: "#667085",
  fontSize: 13,
};

const labelMenuFooter: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: 12,
  borderTop: "1px solid #edf0f2",
  background: "#fff",
};

const attachmentList: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: 12,
  borderTop: "1px solid #edf0f2",
};

const attachmentChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  padding: "5px 8px",
  color: "#344054",
  background: "#f8fafc",
  fontSize: 12,
  fontWeight: 800,
};

const composer: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 2,
  flex: "0 0 auto",
  borderTop: "1px solid #d8dee8",
  background: "#fff",
  boxShadow: "0 -8px 18px rgba(16, 24, 40, 0.06)",
  marginTop: "auto",
};

const composerTabs: React.CSSProperties = {
  height: 40,
  display: "flex",
  alignItems: "end",
  gap: 20,
  padding: "0 14px",
  borderBottom: "1px solid #edf0f2",
};

const activeTab: React.CSSProperties = {
  height: 40,
  border: 0,
  borderBottom: "2px solid #2f7d32",
  background: "transparent",
  color: "#2f7d32",
  fontWeight: 900,
  cursor: "pointer",
};

const inactiveTab: React.CSSProperties = {
  height: 40,
  border: 0,
  background: "transparent",
  color: "#101828",
  fontWeight: 800,
  cursor: "pointer",
};

const disabledTab: React.CSSProperties = {
  height: 40,
  display: "inline-flex",
  alignItems: "center",
  color: "#667085",
  fontWeight: 800,
  cursor: "default",
};

const replyTextarea: React.CSSProperties = {
  width: "100%",
  resize: "vertical",
  minHeight: 92,
  maxHeight: 280,
  border: 0,
  outline: 0,
  padding: 14,
  color: "#101828",
  fontSize: 14,
  lineHeight: 1.5,
};

const composerFooter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: 12,
};

const composerTools: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const composerActions: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const composerAttachmentList: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: "0 12px 10px",
};

const squareTool: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "1px solid #d8dee8",
  borderRadius: 6,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  color: "#344054",
  cursor: "pointer",
};

const attachmentRemoveButton: React.CSSProperties = {
  width: 18,
  height: 18,
  border: 0,
  borderRadius: 999,
  background: "transparent",
  color: "#667085",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  fontSize: 15,
  lineHeight: 1,
};

const primaryButton: React.CSSProperties = {
  minHeight: 36,
  border: 0,
  borderRadius: 6,
  background: "#4f46e5",
  color: "#fff",
  padding: "0 14px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 900,
  cursor: "pointer",
};

const pager: React.CSSProperties = {
  minHeight: 52,
  borderTop: "1px solid #edf0f2",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 12,
  padding: "0 16px",
};

const pagerSummary: React.CSSProperties = {
  marginRight: "auto",
  color: "#667085",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.4,
};

const pagerButton: React.CSSProperties = {
  ...smallButton,
  minWidth: 40,
  height: 36,
  borderRadius: 8,
};

const pagerCurrent: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  background: "#dcfce7",
  color: "#166534",
  display: "grid",
  placeItems: "center",
  fontSize: 14,
  fontWeight: 900,
};

const mutedMini: React.CSSProperties = {
  color: "#667085",
  fontSize: 13,
  lineHeight: 1.4,
};

const emptyWorkspace: React.CSSProperties = {
  minHeight: "calc(100vh - 220px)",
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: 14,
  color: "#98a2b3",
  textAlign: "center",
};

const emptyTitle: React.CSSProperties = {
  margin: 0,
  color: "#344054",
  fontSize: 18,
  fontWeight: 900,
};

const emptyText: React.CSSProperties = {
  margin: 0,
  maxWidth: 480,
  color: "#667085",
  fontSize: 14,
  lineHeight: 1.5,
};

const emptyInline: React.CSSProperties = {
  minHeight: 220,
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: 10,
  color: "#98a2b3",
  textAlign: "center",
  padding: 24,
};

const detailState: React.CSSProperties = {
  flex: 1,
  minHeight: 220,
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: 8,
  padding: 28,
  textAlign: "center",
  color: "#667085",
};

const detailStateTitle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "#101828",
  fontSize: 16,
  fontWeight: 900,
};

const detailStateText: React.CSSProperties = {
  margin: 0,
  maxWidth: 320,
  color: "#667085",
  fontSize: 14,
  lineHeight: 1.5,
};
