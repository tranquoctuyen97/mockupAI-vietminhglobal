"use client";

import {
  ChevronDown,
  Filter,
  Inbox,
  Mail,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Smile,
  Trash2,
  UserPlus,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  EmailBodyRenderer,
  type EmailBodyViewMode,
} from "@/components/mailboxes/EmailBodyRenderer";
import { isHtmlEmail } from "@/lib/mailboxes/email-body-renderer";
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
  id: number;
  mailboxId: string;
  number: string;
  subject: string;
  status: "active" | "pending" | "closed";
  customerId?: number;
  assigneeId?: number;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
  labels?: MailboxLabel[];
  unread?: boolean;
}

interface Thread {
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
  attachments: EmailAttachment[];
  createdAt: string;
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

interface LabelTreeNode {
  key: string;
  segment: string;
  fullName: string;
  label: MailboxLabel | null;
  children: LabelTreeNode[];
}

interface Props {
  stores: StoreOption[];
  initialSelectedStoreId?: string | null;
}

const POLL_INTERVAL = 45_000;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedConversationIdRef = useRef<number | null>(null);

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

  const chooseStore = (storeId: string | null) => {
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

  const syncConversationUnreadState = useCallback((convId: number, unread: boolean) => {
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
    syncConversationUnreadState(conv.id, false);
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/read?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
    } catch (e) {
      syncConversationUnreadState(conv.id, true);
      toast.error(e instanceof Error ? e.message : "Khong the mark email as read");
    }
  }, [selectedMailbox, selectedStoreId, syncConversationUnreadState]);

  const markConversationUnread = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox || conv.unread) return;
    syncConversationUnreadState(conv.id, true);
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/unread?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      toast.success("Đã chuyển email sang unread");
    } catch (e) {
      syncConversationUnreadState(conv.id, false);
      toast.error(e instanceof Error ? e.message : "Khong the mark email as unread");
    }
  }, [selectedMailbox, selectedStoreId, syncConversationUnreadState]);

  const reportConversationSpam = useCallback(async (conv: Conversation) => {
    if (!selectedStoreId || !selectedMailbox) return;
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${conv.id}/report-spam?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        { method: "POST" },
      );
      setConversations((items) => items.filter((item) => item.id !== conv.id));
      setSelectedConv((current) => (current?.id === conv.id ? null : current));
      if (selectedConv?.id === conv.id) {
        setThreads([]);
        setReplyText("");
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
      toast.success("Đã report spam");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the report spam");
    }
  }, [selectedMailbox, selectedConv?.id, selectedStoreId]);

  const loadConversations = useCallback(async () => {
    if (!selectedMailbox || !selectedStoreId) return;
    if (!labelsReady) return;
    if (labels.length > 0 && !effectiveSelectedLabelId) return;
    setConvLoading(true);
    try {
      const qs = new URLSearchParams({
        storeId: selectedStoreId,
        mailboxId: String(selectedMailbox.id),
        page: String(currentPage),
        pageSize: "25",
      });
      if (effectiveSelectedLabelId) qs.set("labelId", effectiveSelectedLabelId);
      const data = await apiFetch<{ conversations: Conversation[]; page: PageInfo }>(
        `/api/mailbox-proxy/conversations?${qs}`,
      );
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
  }, [selectedMailbox, selectedStoreId, effectiveSelectedLabelId, currentPage, labels.length, labelsReady]);

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
    setCurrentPage(1);
  };

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

  const saveConversationLabels = async () => {
    if (!selectedConv || !selectedStoreId || !selectedMailbox) return;
    setConversationLabelsSaving(true);
    try {
      const data = await apiFetch<{ state: string }>(
        `/api/mailbox-proxy/conversations/${selectedConv.id}/labels`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: selectedStoreId,
            mailboxId: selectedMailbox.id,
            labelIds: conversationLabelIds,
          }),
        },
      );
      toast.success(data.state === "PENDING" ? "Đang sync labels sang Gmail" : "Labels đã được lưu");
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
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${selectedConv.id}/threads?storeId=${encodeURIComponent(selectedStoreId)}&mailboxId=${encodeURIComponent(selectedMailbox.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: replyText.trim() }),
        },
      );
      toast.success("Da gui reply");
      setReplyText("");
      void openConversation(selectedConv);
      void loadConversations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the gui reply");
    } finally {
      setSending(false);
    }
  };

  return (
    <main style={pageShell}>
      <header style={topHeader}>
        <div>
          <h1 style={pageTitle}>Mailboxes</h1>
          <p style={pageSubtitle}>Manage support mailboxes and customer conversations</p>
        </div>
        <div style={headerActions}>
          <StoreMenu
            stores={stores}
            mailboxes={mailboxes}
            selectedStore={selectedStore}
            selectedMailbox={selectedMailbox}
            unread={mailboxUnreadCount}
            onChoose={chooseStore}
            onChooseMailbox={chooseMailbox}
          />
          <button type="button" style={manageButton} onClick={() => router.push("/stores")}>
            <Settings size={16} /> Manage stores
          </button>
        </div>
      </header>

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
        <section style={inboxLayout}>
          <FilterRail
            selectedMailbox={selectedMailbox}
            inboxUnreadCount={mailboxUnreadCount}
            labels={labels}
            selectedLabelId={effectiveSelectedLabelId}
            labelComposerOpen={labelComposerOpen}
            newLabelName={newLabelName}
            labelSaving={labelSaving}
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

          <ConversationList
            conversations={conversations}
            selectedId={selectedConv?.id ?? null}
            title={conversationListTitle}
            total={isInboxView ? null : totalConversations}
            loading={convLoading}
            currentPage={currentPage}
            pageInfo={pageInfo}
            onOpen={(conversation) => {
              void (async () => {
                await openConversation(
                  conversation.unread ? { ...conversation, unread: false } : conversation,
                );
                if (conversation.unread) await markConversationRead(conversation);
              })();
            }}
            onRefresh={() => void loadConversations()}
            onPage={setCurrentPage}
          />

          <ConversationDetail
            conversation={selectedConv}
            threads={threads}
            loading={detailLoading}
            labels={labels}
            replyText={replyText}
            sending={sending}
            selectedLabelIds={conversationLabelIds}
            labelsSaving={conversationLabelsSaving}
            onReplyText={setReplyText}
            onSend={() => void sendReply()}
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
          />
        </section>
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

function FilterRail({
  selectedMailbox,
  inboxUnreadCount,
  labels,
  selectedLabelId,
  labelComposerOpen,
  newLabelName,
  labelSaving,
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
  const labelTree = buildLabelTree(userLabels);

  return (
    <aside style={railPanel}>
      <RailHeader title="Mailbox" />
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
      <RailHeader title="Labels" />
      {labelTree.map((node) => (
        <LabelTreeRow
          key={node.key}
          node={node}
          depth={0}
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

function buildLabelTree(labels: MailboxLabel[]): LabelTreeNode[] {
  const root: LabelTreeNode[] = [];
  const nodes = new Map<string, LabelTreeNode>();

  for (const label of labels) {
    const segments = label.name.split("/").filter(Boolean);
    let path = "";
    let level = root;

    segments.forEach((segment, index) => {
      path = path ? `${path}/${segment}` : segment;
      let node = nodes.get(path);
      if (!node) {
        node = {
          key: path,
          segment,
          fullName: path,
          label: null,
          children: [],
        };
        nodes.set(path, node);
        level.push(node);
      }
      if (index === segments.length - 1) {
        node.label = label;
      }
      level = node.children;
    });
  }

  return root;
}

function LabelTreeRow({
  node,
  depth,
  selectedLabelId,
  labelSaving,
  onLabel,
  onRenameLabel,
  onDeleteLabel,
}: {
  node: LabelTreeNode;
  depth: number;
  selectedLabelId: string | null;
  labelSaving: boolean;
  onLabel: (labelId: string | null) => void;
  onRenameLabel: (label: MailboxLabel) => void;
  onDeleteLabel: (label: MailboxLabel) => void;
}) {
  const label = node.label;
  const active = label ? selectedLabelId === label.id : false;
  const text = label
    ? label.state === "ACTIVE"
      ? node.segment
      : `${node.segment} (${label.state.toLowerCase()})`
    : node.segment;
  const count = label?.conversationCount;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: depth * 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RailButton
            active={active}
            dot="#7c3aed"
            label={text}
            count={count}
            onClick={
              label && label.state === "ACTIVE"
                ? () => onLabel(label.id)
                : undefined
            }
          />
        </div>
        {label?.mutable && (
          <>
            <button
              type="button"
              disabled={labelSaving}
              onClick={() => onRenameLabel(label)}
              style={iconButton}
              aria-label={`Rename ${label.name}`}
            >
              <Settings size={13} />
            </button>
            <button
              type="button"
              disabled={labelSaving}
              onClick={() => onDeleteLabel(label)}
              style={iconButton}
              aria-label={`Delete ${label.name}`}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      {node.children.map((child) => (
        <LabelTreeRow
          key={child.key}
          node={child}
          depth={depth + 1}
          selectedLabelId={selectedLabelId}
          labelSaving={labelSaving}
          onLabel={onLabel}
          onRenameLabel={onRenameLabel}
          onDeleteLabel={onDeleteLabel}
        />
      ))}
    </>
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
  onOpen,
  onRefresh,
  onPage,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  title: string;
  total: number | null;
  loading: boolean;
  currentPage: number;
  pageInfo: PageInfo | null;
  onOpen: (conversation: Conversation) => void;
  onRefresh: () => void;
  onPage: (page: number) => void;
}) {
  return (
    <section style={listPanel}>
      <div style={listToolbar}>
        <div style={listTitle}>
          <strong>{title}</strong>
          {typeof total === "number" ? <span style={smallCount}>{total}</span> : null}
        </div>
        <div style={toolbarButtons}>
          <button type="button" style={smallButton}>
            <Filter size={15} /> Filter
          </button>
          <button type="button" style={smallButton}>
            Sort: Newest <ChevronDown size={15} />
          </button>
          <button type="button" style={iconButton} onClick={onRefresh} title="Refresh">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

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
              onClick={() => onOpen(conversation)}
            />
          ))
        )}
      </div>

      {pageInfo && pageInfo.totalPages > 1 && (
        <div style={pager}>
          <button
            type="button"
            style={smallButton}
            disabled={currentPage <= 1}
            onClick={() => onPage(currentPage - 1)}
          >
            Prev
          </button>
          <span style={mutedMini}>
            Page {currentPage} of {pageInfo.totalPages}
          </span>
          <button
            type="button"
            style={smallButton}
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
  onClick,
}: {
  conversation: Conversation;
  selected: boolean;
  index: number;
  onClick: () => void;
}) {
  const contactName = displayMailboxIdentity(conversation);
  const rowLabels = conversation.labels ?? [];
  const visibleLabels = rowLabels.slice(0, 2);
  const hiddenLabelCount = Math.max(0, rowLabels.length - visibleLabels.length);
  const unread = conversation.unread ?? false;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        ...conversationRow,
        background: selected ? "#eef9e9" : unread ? "#fbfff8" : "#fff",
        borderLeft: unread ? "3px solid #84cc16" : "3px solid transparent",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          ...checkboxStyle,
          background: selected ? "#2563eb" : "#fff",
          borderColor: selected ? "#2563eb" : "#cbd5e1",
        }}
      >
        {selected ? "✓" : ""}
      </span>
      <Avatar label={contactName} index={conversation.id || index} />
      <div style={rowBody}>
        <div style={rowTop}>
          <div style={rowIdentity}>
            {unread ? <span style={unreadDot} /> : null}
            <strong style={{ ...truncate, fontWeight: unread ? 900 : 600, color: unread ? "#101828" : "#344054" }}>
              {contactName}
            </strong>
          </div>
          <span style={{ ...timeText, color: unread ? "#101828" : "#667085", fontWeight: unread ? 800 : 500 }}>
            {formatTime(conversation.updatedAt)}
          </span>
        </div>
        <div style={{ ...rowSubject, fontWeight: unread ? 800 : 500, color: unread ? "#101828" : "#667085" }}>
          {conversation.subject || "(no subject)"}
        </div>
        <div style={rowMeta}>
          {visibleLabels.map((label) => (
            <span key={label.id} style={neutralBadge}>{label.name}</span>
          ))}
          {hiddenLabelCount > 0 ? <span style={neutralBadge}>+{hiddenLabelCount}</span> : null}
        </div>
      </div>
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
  selectedLabelIds,
  labelsSaving,
  onReplyText,
  onSend,
  onMarkUnread,
  onReportSpam,
  onToggleLabel,
  onSaveLabels,
}: {
  conversation: Conversation | null;
  threads: Thread[];
  loading: boolean;
  labels: MailboxLabel[];
  replyText: string;
  sending: boolean;
  selectedLabelIds: string[];
  labelsSaving: boolean;
  onReplyText: (value: string) => void;
  onSend: () => void;
  onMarkUnread: () => void;
  onReportSpam: () => void;
  onToggleLabel: (labelId: string) => void;
  onSaveLabels: () => void;
}) {
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [labelQuery, setLabelQuery] = useState("");
  useEffect(() => {
    setLabelMenuOpen(false);
    setLabelQuery("");
  }, [conversation?.id]);

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

  if (!conversation) {
    return (
      <section style={detailPanel}>
        <DetailState
          title="Select a conversation"
          text="Choose an email from the list to read the message and reply."
        />
      </section>
    );
  }

  const visibleThreads = threads.filter((thread) => !thread.hidden);
  const firstThread = visibleThreads.find((thread) => !thread.internal && (thread.from || thread.sender))
    ?? visibleThreads.find((thread) => thread.from || thread.sender)
    ?? visibleThreads[0]
    ?? threads[0];
  const hasLoadedBody = visibleThreads.length > 0;
  const sender = parseEmailIdentity(firstThread?.from || firstThread?.sender);
  const detailContactName = sender.name || displayMailboxIdentity(conversation);
  const detailContactEmail = sender.email || conversation.fromEmail || "Email address unavailable";
  const detailDate = firstThread?.createdAt ?? conversation.updatedAt;
  const detailSubject = firstThread?.subject || conversation.subject || "(no subject)";
  const conversationLabels = conversation.labels ?? [];
  const visibleLabelChips = conversationLabels.slice(0, 2);
  const hiddenLabelCount = Math.max(0, conversationLabels.length - visibleLabelChips.length);
  const filteredUserLabels = labels.filter((label) =>
    label.type === "USER"
    && label.state === "ACTIVE"
    && label.name.toLocaleLowerCase("en-US").includes(labelQuery.trim().toLocaleLowerCase("en-US")),
  );

  return (
    <section style={detailPanel}>
      <header style={detailHeader}>
        <Avatar label={detailContactName} index={conversation.id} large />
        <div style={{ minWidth: 0 }}>
          <h2 style={detailName}>{detailContactName}</h2>
          <div style={customerEmail}>{detailContactEmail}</div>
          <div style={detailSubjectLine}>{detailSubject}</div>
          <div style={detailDateLine}>{formatTime(detailDate)}</div>
          <div style={detailTags}>
            <span style={neutralBadge}>Email</span>
            {visibleLabelChips.map((label) => (
              <span key={label.id} style={neutralBadge}>{label.name}</span>
            ))}
            {hiddenLabelCount > 0 ? <span style={neutralBadge}>+{hiddenLabelCount} more</span> : null}
          </div>
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
        <div style={threadArea}>
          {hasLoadedBody ? (
            visibleThreads.map((thread, index) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                fallbackSubject={index === 0 ? conversation.subject : undefined}
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
            <button type="button" style={activeTab}>
              Reply
            </button>
            <button type="button" style={inactiveTab}>
              Internal note
            </button>
          </div>
          <textarea
            value={replyText}
            onChange={(event) => onReplyText(event.target.value)}
            placeholder="Write your reply..."
            rows={4}
            style={replyTextarea}
          />
          <div style={composerFooter}>
            <div style={composerTools}>
              <button type="button" style={squareTool}>
                <Paperclip size={16} />
              </button>
              <button type="button" style={squareTool}>
                <Smile size={16} />
              </button>
              <button type="button" style={squareTool}>
                <Zap size={16} />
              </button>
              <button type="button" style={squareTool}>
                <MoreHorizontal size={16} />
              </button>
            </div>
            <div style={composerActions}>
              <button type="button" style={smallButton}>
                <UserPlus size={15} /> Assign
              </button>
              <button
                type="button"
                style={primaryButton}
                disabled={sending || !replyText.trim()}
                onClick={onSend}
              >
                <Send size={15} /> Reply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ThreadCard({ thread, fallbackSubject }: { thread: Thread; fallbackSubject?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showImages, setShowImages] = useState(true);
  const [bodyMode, setBodyMode] = useState<EmailBodyViewMode>("rendered");
  const html = isHtmlEmail(thread.contentType, thread.body);
  const realAttachments = thread.attachments.filter((attachment) => {
    const filename = attachment.filename.toLowerCase();
    return filename !== "message.html" && filename !== "message.htm";
  });

  const setModeFromMenu = (mode: EmailBodyViewMode) => {
    setBodyMode((current) => (current === mode ? "rendered" : mode));
    setMenuOpen(false);
  };

  return (
    <article style={threadCard}>
      <div style={emailHeader}>
        <div style={emailHeaderTop}>
          <div style={threadMetaLine}>
            {thread.displayType === "app_reply"
              ? "Reply"
              : thread.displayType === "internal"
                ? "Internal note"
                : "Message"}
          </div>
          <div style={messageMenuWrap}>
            <button
              type="button"
              style={messageMenuButton}
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="Message actions"
            >
              <MoreHorizontal size={17} />
            </button>
            {menuOpen ? (
              <div style={messageMenu}>
                <button
                  type="button"
                  style={messageMenuItem}
                  onClick={() => setModeFromMenu("source")}
                >
                  View original
                </button>
                <button type="button" style={messageMenuItem} disabled>
                  Download .eml unavailable
                </button>
                <button
                  type="button"
                  style={messageMenuItem}
                  onClick={() => setModeFromMenu("plain")}
                >
                  {bodyMode === "plain" ? "Show rendered email" : "Show plain text"}
                </button>
                {html ? (
                  <button
                    type="button"
                    style={messageMenuItem}
                    onClick={() => {
                      setShowImages((value) => !value);
                      setMenuOpen(false);
                    }}
                  >
                    {showImages ? "Hide remote images" : "Show remote images"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <EmailBodyRenderer
        body={thread.body}
        contentType={thread.contentType}
        mode={bodyMode}
        showImages={showImages}
      />
      {realAttachments.length > 0 ? (
        <div style={attachmentList}>
          {realAttachments.map((attachment) => (
            <span key={attachment.id} style={attachmentChip}>
              <Paperclip size={13} /> {attachment.filename}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RailHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={railHeader}>
      <span>{title}</span>
      {action && (
        <button type="button" style={railAction}>
          {action}
        </button>
      )}
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
}: {
  label: string;
  index?: number;
  large?: boolean;
}) {
  const colors = ["#f7d7c4", "#d7f3dc", "#dbeafe", "#fde68a"];
  return (
    <span
      style={{
        ...avatar,
        width: large ? 46 : 38,
        height: large ? 46 : 38,
        background: colors[index % colors.length],
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

const pageShell: React.CSSProperties = {
  height: "calc(100vh - 64px)",
  width: "100%",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 22,
  overflow: "hidden",
};

const topHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  minWidth: 0,
};

const pageTitle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 30,
  lineHeight: 1.12,
  fontWeight: 900,
  letterSpacing: 0,
};

const pageSubtitle: React.CSSProperties = {
  margin: "10px 0 0",
  color: "#475467",
  fontSize: 15,
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
  maxWidth: "100%",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
  background: "#fff",
  border: "1px solid #d8dee8",
  borderRadius: 8,
  boxShadow: "0 10px 24px rgba(16, 24, 40, 0.04)",
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
  display: "grid",
  gap: 0,
  textAlign: "right",
  color: "#475467",
  fontSize: 11,
  lineHeight: 1.1,
};

const manageButton: React.CSSProperties = {
  height: 56,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  padding: "0 18px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "#101828",
  fontWeight: 800,
  cursor: "pointer",
};

const inboxLayout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px minmax(300px, 0.92fr) minmax(0, 1.18fr)",
  gap: 14,
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #d8dee8",
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "0 14px 28px rgba(16, 24, 40, 0.04)",
  minWidth: 0,
  minHeight: 0,
};

const railPanel: React.CSSProperties = {
  ...panel,
  overflow: "auto",
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

const railButton: React.CSSProperties = {
  width: "calc(100% - 16px)",
  margin: "0 8px 3px",
  minHeight: 36,
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

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
};

const listToolbar: React.CSSProperties = {
  height: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "0 12px 0 18px",
  borderBottom: "1px solid #edf0f2",
};

const listTitle: React.CSSProperties = {
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
  minHeight: 82,
  border: 0,
  borderBottom: "1px solid #edf0f2",
  display: "grid",
  gridTemplateColumns: "20px 40px minmax(0, 1fr)",
  gap: 12,
  padding: "12px 12px 12px 16px",
  textAlign: "left",
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  margin: "7px 0 0",
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
  marginTop: 5,
  color: "#101828",
  fontSize: 13,
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
  marginTop: 8,
  flexWrap: "wrap",
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
  border: "1px solid #d8dee8",
  background: "#f8fafc",
  color: "#475467",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 12,
  fontWeight: 800,
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
  padding: "18px 20px 14px",
  borderBottom: "1px solid #edf0f2",
  flex: "0 0 auto",
};

const detailName: React.CSSProperties = {
  margin: 0,
  color: "#101828",
  fontSize: 18,
  fontWeight: 900,
};

const customerEmail: React.CSSProperties = {
  marginTop: 4,
  color: "#475467",
  fontSize: 13,
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
  background: "#f8fafc",
  minWidth: 0,
};

const threadArea: React.CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: 14,
  padding: "16px 18px 20px",
  minWidth: 0,
};

const threadCard: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 12,
  padding: 0,
  background: "#fff",
  overflow: "hidden",
  boxShadow: "0 8px 24px rgba(16, 24, 40, 0.04)",
  minWidth: 0,
};

const emailHeader: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: "10px 14px",
  background: "#fff",
  borderBottom: "1px solid #edf0f2",
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

const messageMenuButton: React.CSSProperties = {
  ...iconButton,
  width: 32,
  height: 32,
  background: "#fff",
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

const messageMenuItem: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "#344054",
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "left",
  cursor: "pointer",
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
  justifyContent: "center",
  gap: 10,
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
