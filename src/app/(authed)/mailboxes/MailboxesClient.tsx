"use client";

import {
  Archive,
  CheckCircle2,
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
  id: number;
  name: string;
  active: boolean;
}

interface Conversation {
  id: number;
  mailboxId: number;
  number: string;
  subject: string;
  status: "active" | "pending" | "closed";
  customerId: number;
  assigneeId?: number;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
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

type StatusFilter = "active" | "pending" | "closed";

interface Props {
  stores: StoreOption[];
  initialSelectedStoreId?: string | null;
}

const POLL_INTERVAL = 45_000;

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: "New",
  pending: "Pending",
  closed: "Resolved",
};

const STATUS_COLORS: Record<
  StatusFilter,
  { dot: string; bg: string; text: string; border: string }
> = {
  active: { dot: "#2563eb", bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  pending: { dot: "#f59e0b", bg: "#fff7ed", text: "#b45309", border: "#fed7aa" },
  closed: { dot: "#16a34a", bg: "#ecfdf3", text: "#15803d", border: "#bbf7d0" },
};

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
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
  const [statusUpdating, setStatusUpdating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );
  const totalConversations = pageInfo?.totalElements ?? conversations.length;

  const chooseStore = (storeId: string | null) => {
    setSelectedStoreId(storeId);
    setSelectedMailbox(null);
    setSelectedConv(null);
    setThreads([]);
    setConversations([]);
    setPageInfo(null);
    setCurrentPage(1);
    setStatusFilter("active");
    router.replace(storeId ? `/mailboxes?storeId=${storeId}` : "/mailboxes");
  };

  useEffect(() => {
    if (!selectedStoreId) {
      setMailboxes([]);
      setSelectedMailbox(null);
      return;
    }
    setLoadingMailboxes(true);
    setMailboxes([]);
    setSelectedMailbox(null);
    apiFetch<{ mailboxes: Mailbox[] }>(
      `/api/mailbox-proxy/mailboxes?storeId=${encodeURIComponent(selectedStoreId)}`,
    )
      .then((data) => {
        const activeMailboxes = data.mailboxes.filter((mailbox) => mailbox.active);
        setMailboxes(activeMailboxes);
        setSelectedMailbox(activeMailboxes[0] ?? null);
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoadingMailboxes(false));
  }, [selectedStoreId]);

  const openConversation = useCallback(
    async (conv: Conversation) => {
      if (!selectedStoreId) return;
      setDetailLoading(true);
      setSelectedConv(conv);
      setThreads([]);
      setReplyText("");
      try {
        const data = await apiFetch<{ conversation: Conversation; threads: Thread[] }>(
          `/api/mailbox-proxy/conversations/${conv.id}?storeId=${encodeURIComponent(selectedStoreId)}`,
        );
        setSelectedConv(data.conversation);
        setThreads(data.threads);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Khong the mo conversation");
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedStoreId],
  );

  const loadConversations = useCallback(async () => {
    if (!selectedMailbox || !selectedStoreId) return;
    setConvLoading(true);
    try {
      const qs = new URLSearchParams({
        storeId: selectedStoreId,
        mailboxId: String(selectedMailbox.id),
        status: statusFilter,
        page: String(currentPage),
        pageSize: "25",
      });
      const data = await apiFetch<{ conversations: Conversation[]; page: PageInfo }>(
        `/api/mailbox-proxy/conversations?${qs}`,
      );
      setConversations(data.conversations);
      setPageInfo(data.page);
      if (!selectedConv && data.conversations[0]) {
        void openConversation(data.conversations[0]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the tai conversations");
    } finally {
      setConvLoading(false);
    }
  }, [selectedMailbox, selectedStoreId, statusFilter, currentPage, selectedConv, openConversation]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void loadConversations(), POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadConversations]);

  const sendReply = async () => {
    if (!selectedConv || !replyText.trim() || !selectedStoreId) return;
    setSending(true);
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${selectedConv.id}/threads?storeId=${encodeURIComponent(selectedStoreId)}`,
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

  const updateStatus = async (newStatus: StatusFilter) => {
    if (!selectedConv || !selectedStoreId) return;
    setStatusUpdating(true);
    try {
      await apiFetch(
        `/api/mailbox-proxy/conversations/${selectedConv.id}?storeId=${encodeURIComponent(selectedStoreId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      setSelectedConv((prev) => (prev ? { ...prev, status: newStatus } : prev));
      void loadConversations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Khong the cap nhat status");
    } finally {
      setStatusUpdating(false);
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
            selectedStore={selectedStore}
            selectedMailbox={selectedMailbox}
            unread={totalConversations}
            onChoose={chooseStore}
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
      ) : !selectedMailbox || mailboxes.length === 0 ? (
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
      ) : (
        <section style={inboxLayout}>
          <FilterRail
            activeStatus={statusFilter}
            total={totalConversations}
            onStatus={(status) => {
              setStatusFilter(status);
              setCurrentPage(1);
              setSelectedConv(null);
              setThreads([]);
            }}
          />

          <ConversationList
            conversations={conversations}
            selectedId={selectedConv?.id ?? null}
            total={totalConversations}
            loading={convLoading}
            currentPage={currentPage}
            pageInfo={pageInfo}
            selectedStoreName={selectedStore?.name ?? "Store"}
            onOpen={(conversation) => void openConversation(conversation)}
            onRefresh={() => void loadConversations()}
            onPage={setCurrentPage}
          />

          <ConversationDetail
            conversation={selectedConv}
            threads={threads}
            loading={detailLoading}
            selectedStoreName={selectedStore?.name ?? "Store"}
            replyText={replyText}
            sending={sending}
            statusUpdating={statusUpdating}
            onReplyText={setReplyText}
            onSend={() => void sendReply()}
            onStatus={(status) => void updateStatus(status)}
          />
        </section>
      )}
    </main>
  );
}

function StoreMenu({
  stores,
  selectedStore,
  selectedMailbox,
  unread,
  onChoose,
}: {
  stores: StoreOption[];
  selectedStore: StoreOption | null;
  selectedMailbox: Mailbox | null;
  unread: number;
  onChoose: (storeId: string | null) => void;
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
      <span style={activePill}>{selectedMailbox ? "Active mailbox" : "No mailbox"}</span>
      <span style={unreadBlock}>
        <strong>{unread}</strong>
        <span>unread</span>
      </span>
      <ChevronDown size={16} color="#475467" />
    </div>
  );
}

function FilterRail({
  activeStatus,
  total,
  onStatus,
}: {
  activeStatus: StatusFilter;
  total: number;
  onStatus: (status: StatusFilter) => void;
}) {
  return (
    <aside style={railPanel}>
      <RailHeader title="Status" />
      {(["active", "pending", "closed"] as StatusFilter[]).map((status) => (
        <RailButton
          key={status}
          active={activeStatus === status}
          dot={STATUS_COLORS[status].dot}
          label={STATUS_LABELS[status]}
          count={activeStatus === status ? total : undefined}
          onClick={() => onStatus(status)}
        />
      ))}
    </aside>
  );
}

function ConversationList({
  conversations,
  selectedId,
  total,
  loading,
  currentPage,
  pageInfo,
  selectedStoreName,
  onOpen,
  onRefresh,
  onPage,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  total: number;
  loading: boolean;
  currentPage: number;
  pageInfo: PageInfo | null;
  selectedStoreName: string;
  onOpen: (conversation: Conversation) => void;
  onRefresh: () => void;
  onPage: (page: number) => void;
}) {
  return (
    <section style={listPanel}>
      <div style={listToolbar}>
        <div style={listTitle}>
          <strong>All conversations</strong>
          <span style={smallCount}>{total}</span>
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
              storeName={selectedStoreName}
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
  storeName,
  onClick,
}: {
  conversation: Conversation;
  selected: boolean;
  index: number;
  storeName: string;
  onClick: () => void;
}) {
  const status = STATUS_COLORS[conversation.status];
  const contactName = displayMailboxIdentity(conversation);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...conversationRow, background: selected ? "#f1fae9" : "#fff" }}
    >
      <input type="checkbox" readOnly checked={selected} style={checkboxStyle} />
      <Avatar label={contactName} index={index} />
      <div style={rowBody}>
        <div style={rowTop}>
          <strong style={truncate}>{contactName}</strong>
          <span style={timeText}>{formatTime(conversation.updatedAt)}</span>
        </div>
        <div style={rowSubject}>{conversation.subject || "(no subject)"}</div>
        <div style={rowSnippet}>
          {conversation.articleCount} message{conversation.articleCount === 1 ? "" : "s"} in this
          conversation
        </div>
        <div style={rowMeta}>
          <span
            style={{
              ...statusBadge,
              background: status.bg,
              color: status.text,
              borderColor: status.border,
            }}
          >
            {STATUS_LABELS[conversation.status]}
          </span>
          <span style={storeBadge}>{storeName}</span>
        </div>
      </div>
    </button>
  );
}

function ConversationDetail({
  conversation,
  threads,
  loading,
  selectedStoreName,
  replyText,
  sending,
  statusUpdating,
  onReplyText,
  onSend,
  onStatus,
}: {
  conversation: Conversation | null;
  threads: Thread[];
  loading: boolean;
  selectedStoreName: string;
  replyText: string;
  sending: boolean;
  statusUpdating: boolean;
  onReplyText: (value: string) => void;
  onSend: () => void;
  onStatus: (status: StatusFilter) => void;
}) {
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

  const status = STATUS_COLORS[conversation.status];
  const firstThread = threads[0];
  const hasLoadedBody = threads.length > 0;
  const sender = parseEmailIdentity(firstThread?.from || firstThread?.sender);
  const detailContactName = sender.name || displayMailboxIdentity(conversation);
  const detailContactEmail = sender.email || conversation.fromEmail || "Email address unavailable";

  return (
    <section style={detailPanel}>
      <header style={detailHeader}>
        <Avatar label={detailContactName} index={conversation.customerId} large />
        <div style={{ minWidth: 0 }}>
          <h2 style={detailName}>{detailContactName}</h2>
          <div style={customerEmail}>{detailContactEmail}</div>
          <div style={detailTags}>
            <span style={storeBadge}>{selectedStoreName}</span>
            <span style={neutralBadge}>Email</span>
            <span
              style={{
                ...statusBadge,
                background: status.bg,
                color: status.text,
                borderColor: status.border,
              }}
            >
              {STATUS_LABELS[conversation.status]}
            </span>
          </div>
        </div>
        <button type="button" style={{ ...iconButton, marginLeft: "auto" }}>
          <MoreHorizontal size={17} />
        </button>
      </header>

      <div style={detailBody}>
        <div style={orderCard}>
          <span style={orderIcon}>
            <Archive size={20} />
          </span>
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <strong>Order</strong>
              <strong>#{conversation.number}</strong>
              <span style={paidBadge}>Paid</span>
            </div>
            <div style={orderMeta}>May 21, 2024 • $39.99 • 2 items</div>
          </div>
          <button type="button" style={{ ...smallButton, marginLeft: "auto" }}>
            View order
          </button>
        </div>

        <div style={threadArea}>
          {hasLoadedBody ? (
            <>
              {threads.map((thread, index) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  fallbackSubject={index === 0 ? conversation.subject : undefined}
                />
              ))}
              <div style={noteCard}>
                <div style={noteTop}>
                  <strong>Internal note by Jane Doe</strong>
                  <span>{formatTime(firstThread?.createdAt ?? conversation.updatedAt)}</span>
                </div>
                <p style={{ margin: "8px 0 0" }}>
                  Customer is asking about the delivery status. Check order and mailbox sync before
                  replying.
                </p>
              </div>
            </>
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
                style={resolveButton}
                disabled={statusUpdating}
                onClick={() => onStatus("closed")}
              >
                <CheckCircle2 size={15} /> Mark resolved
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
  const subject = thread.subject || fallbackSubject || "(no subject)";
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
          <div style={emailHeaderGrid}>
            <div style={emailHeaderRow}>
              <span>From</span>
              <strong>{thread.from || thread.sender || "Unknown sender"}</strong>
            </div>
            {thread.to ? (
              <div style={emailHeaderRow}>
                <span>To</span>
                <strong>{thread.to}</strong>
              </div>
            ) : null}
            {thread.cc ? (
              <div style={emailHeaderRow}>
                <span>Cc</span>
                <strong>{thread.cc}</strong>
              </div>
            ) : null}
            <div style={emailHeaderRow}>
              <span>Date</span>
              <strong>{formatTime(thread.createdAt)}</strong>
            </div>
            <div style={emailHeaderRow}>
              <span>Subject</span>
              <strong>{subject}</strong>
            </div>
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
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const pageShell: React.CSSProperties = {
  height: "calc(100vh - 64px)",
  minHeight: 0,
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
};

const storeMenu: React.CSSProperties = {
  height: 56,
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
  gridTemplateColumns: "230px minmax(360px, 1fr) minmax(440px, 1.25fr)",
  gap: 14,
  flex: 1,
  minHeight: 0,
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
  gap: 10,
};

const truncate: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
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
};

const statusBadge: React.CSSProperties = {
  border: "1px solid",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 12,
  fontWeight: 800,
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
};

const detailHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 14,
  padding: 20,
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
  marginTop: 6,
  color: "#475467",
  fontSize: 14,
};

const detailTags: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  marginTop: 10,
};

const orderCard: React.CSSProperties = {
  margin: 14,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  minHeight: 72,
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: 14,
};

const orderIcon: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "#2f7d32",
  background: "#eef9e9",
};

const paidBadge: React.CSSProperties = {
  borderRadius: 6,
  padding: "3px 8px",
  background: "#dcfce7",
  color: "#15803d",
  fontSize: 12,
  fontWeight: 900,
};

const orderMeta: React.CSSProperties = {
  marginTop: 6,
  color: "#475467",
  fontSize: 13,
};

const detailBody: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
};

const threadArea: React.CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: 12,
  padding: "0 14px 14px",
};

const threadCard: React.CSSProperties = {
  border: "1px solid #d8dee8",
  borderRadius: 8,
  padding: 0,
  background: "#fff",
  overflow: "hidden",
};

const emailHeader: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 14,
  background: "#f8fafc",
  borderBottom: "1px solid #edf0f2",
};

const emailHeaderTop: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
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
  zIndex: 5,
  minWidth: 190,
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

const noteCard: React.CSSProperties = {
  border: "1px solid #fde68a",
  borderRadius: 8,
  padding: 14,
  background: "#fffbeb",
  color: "#344054",
  fontSize: 14,
};

const noteTop: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  color: "#344054",
  fontSize: 13,
};

const composer: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 2,
  flex: "0 0 auto",
  borderTop: "1px solid #d8dee8",
  background: "#fff",
  boxShadow: "0 -8px 18px rgba(16, 24, 40, 0.06)",
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

const resolveButton: React.CSSProperties = {
  ...smallButton,
  background: "#e6f7df",
  borderColor: "#c7eabd",
  color: "#2f7d32",
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
