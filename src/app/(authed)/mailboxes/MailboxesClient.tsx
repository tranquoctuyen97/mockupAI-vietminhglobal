"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Inbox, Loader2, Mail, MailOpen, RefreshCw, Send, X } from "lucide-react";

/* ────── Types (normalized from server proxy) ────── */
interface Mailbox { id: number; name: string; active: boolean }
interface Conversation {
  id: number; mailboxId: number; number: string; subject: string;
  status: "active" | "pending" | "closed"; customerId: number;
  assigneeId?: number; updatedAt: string; createdAt: string; articleCount: number;
}
interface Thread {
  id: number; conversationId: number; body: string; contentType: string;
  from?: string; to?: string; cc?: string; type: string;
  sender?: string; internal: boolean; attachments: unknown[];
  createdAt: string;
}
interface PageInfo { size: number; totalElements: number; totalPages: number; number: number }

type StatusFilter = "active" | "pending" | "closed";
const STATUS_LABELS: Record<StatusFilter, string> = { active: "Open", pending: "Pending", closed: "Closed" };
const POLL_INTERVAL = 45_000;

/* ────── Fetch helpers ────── */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ────── Main component ────── */
export default function MailboxesClient() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<Mailbox | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [convLoading, setConvLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load mailboxes ──
  useEffect(() => {
    setLoading(true);
    apiFetch<{ mailboxes: Mailbox[] }>("/api/mailbox-proxy/mailboxes")
      .then((d) => {
        setMailboxes(d.mailboxes);
        if (d.mailboxes.length > 0) setSelectedMailbox(d.mailboxes[0]);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Load conversations (when mailbox/status/page changes) ──
  const loadConversations = useCallback(async () => {
    if (!selectedMailbox) return;
    setConvLoading(true);
    try {
      const qs = new URLSearchParams({ mailboxId: String(selectedMailbox.id), status: statusFilter, page: String(currentPage), pageSize: "25" });
      const d = await apiFetch<{ conversations: Conversation[]; page: PageInfo }>(`/api/mailbox-proxy/conversations?${qs}`);
      setConversations(d.conversations);
      setPageInfo(d.page);
    } catch (e: any) { toast.error(e.message); }
    finally { setConvLoading(false); }
  }, [selectedMailbox, statusFilter, currentPage]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── Polling ──
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(loadConversations, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadConversations]);

  // ── Open conversation detail ──
  const openConversation = async (conv: Conversation) => {
    setDetailLoading(true);
    setSelectedConv(null);
    setThreads([]);
    setReplyText("");
    try {
      const d = await apiFetch<{ conversation: Conversation; threads: Thread[] }>(`/api/mailbox-proxy/conversations/${conv.id}`);
      setSelectedConv(d.conversation);
      setThreads(d.threads);
    } catch (e: any) { toast.error(e.message); }
    finally { setDetailLoading(false); }
  };

  // ── Send reply ──
  const sendReply = async () => {
    if (!selectedConv || !replyText.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/api/mailbox-proxy/conversations/${selectedConv.id}/threads`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: replyText.trim() }),
      });
      toast.success("Đã gửi reply");
      setReplyText("");
      openConversation(selectedConv); // refresh threads
      loadConversations();
    } catch (e: any) { toast.error(e.message); }
    finally { setSending(false); }
  };

  // ── Update status ──
  const updateStatus = async (newStatus: StatusFilter) => {
    if (!selectedConv) return;
    setStatusUpdating(true);
    try {
      await apiFetch(`/api/mailbox-proxy/conversations/${selectedConv.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }),
      });
      toast.success(`Status → ${STATUS_LABELS[newStatus]}`);
      setSelectedConv((prev) => prev ? { ...prev, status: newStatus } : prev);
      loadConversations();
    } catch (e: any) { toast.error(e.message); }
    finally { setStatusUpdating(false); }
  };

  // ── Error / empty states ──
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (mailboxes.length === 0) return <EmptyState icon="📭" message="Bạn chưa được assign vào mailbox nào. Vui lòng liên hệ SUPER_ADMIN." />;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 7rem)", gap: 0, borderRadius: "var(--radius-xl)", overflow: "hidden", border: "1px solid var(--border-default)", backgroundColor: "var(--bg-surface)" }}>
      {/* ── Left sidebar: mailboxes + status filters ── */}
      <aside style={{ width: 240, flexShrink: 0, borderRight: "1px solid var(--border-default)", display: "flex", flexDirection: "column", backgroundColor: "var(--bg-secondary)" }}>
        <div style={{ padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {(["active", "pending", "closed"] as StatusFilter[]).map((s) => (
            <button key={s} type="button" onClick={() => { setStatusFilter(s); setCurrentPage(1); setSelectedConv(null); setThreads([]); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.875rem", backgroundColor: statusFilter === s ? "rgba(159,232,112,0.15)" : "transparent", color: statusFilter === s ? "var(--color-wise-dark-green)" : "var(--text-secondary)", transition: "all 150ms" }}>
              {s === "active" ? <MailOpen size={16} /> : s === "pending" ? <Loader2 size={16} /> : <X size={16} />}
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div style={{ borderTop: "1px solid var(--border-default)", padding: "16px 16px 8px", fontWeight: 700, fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Mailboxes</div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 8px 16px" }}>
          {mailboxes.map((mb) => (
            <button key={mb.id} type="button" onClick={() => { setSelectedMailbox(mb); setCurrentPage(1); setSelectedConv(null); setThreads([]); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left", fontWeight: 500, fontSize: "0.875rem", backgroundColor: selectedMailbox?.id === mb.id ? "var(--color-wise-green)" : "transparent", color: selectedMailbox?.id === mb.id ? "var(--color-wise-dark-green)" : "var(--text-primary)", transition: "all 150ms" }}>
              <Mail size={14} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mb.name}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Middle: conversation list ── */}
      <div style={{ width: 360, flexShrink: 0, borderRight: "1px solid var(--border-default)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{selectedMailbox?.name ?? "Email"}</span>
          <button type="button" onClick={loadConversations} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, borderRadius: "var(--radius-sm)" }} title="Refresh">
            <RefreshCw size={14} className={convLoading ? "animate-spin" : ""} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {convLoading && conversations.length === 0 ? <LoadingState /> :
           conversations.length === 0 ? <EmptyState icon="📧" message="Không có email nào trong mục này." /> :
           conversations.map((c) => (
            <button key={c.id} type="button" onClick={() => openConversation(c)}
              style={{ width: "100%", display: "block", padding: "12px 16px", borderBottom: "1px solid var(--border-default)", border: "none", borderLeft: selectedConv?.id === c.id ? "3px solid var(--color-wise-green)" : "3px solid transparent", cursor: "pointer", textAlign: "left", backgroundColor: selectedConv?.id === c.id ? "rgba(159,232,112,0.08)" : "transparent", transition: "all 100ms" }}>
              <div style={{ fontWeight: 600, fontSize: "0.8125rem", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>#{c.number}</div>
              <div style={{ fontSize: "0.8125rem", fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{c.subject || "(no subject)"}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.articleCount} message{c.articleCount !== 1 ? "s" : ""}</div>
              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 4 }}>{c.updatedAt ? new Date(c.updatedAt).toLocaleString("vi-VN") : ""}</div>
            </button>
          ))}
        </div>
        {pageInfo && pageInfo.totalPages > 1 && (
          <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem" }}>
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)} className="btn-secondary btn-sm">← Trước</button>
            <span style={{ color: "var(--text-muted)" }}>{currentPage}/{pageInfo.totalPages}</span>
            <button type="button" disabled={currentPage >= pageInfo.totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="btn-secondary btn-sm">Sau →</button>
          </div>
        )}
      </div>

      {/* ── Right: conversation detail ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {detailLoading ? <LoadingState /> :
         !selectedConv ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", opacity: 0.4 }}>
              <Inbox size={48} />
              <p style={{ marginTop: 8, fontSize: "0.875rem" }}>Chọn một email để xem</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontWeight: 700, fontSize: "1rem", margin: 0, wordBreak: "break-word" }}>{selectedConv.subject || "(no subject)"}</h2>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                  #{selectedConv.number}
                  <span className="badge badge-info" style={{ marginLeft: 8, fontSize: "0.625rem" }}>{STATUS_LABELS[selectedConv.status] ?? selectedConv.status}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {selectedConv.status !== "active" && <button type="button" className="btn-secondary btn-sm" disabled={statusUpdating} onClick={() => updateStatus("active")}>Mở lại</button>}
                {selectedConv.status !== "pending" && <button type="button" className="btn-secondary btn-sm" disabled={statusUpdating} onClick={() => updateStatus("pending")}>Pending</button>}
                {selectedConv.status !== "closed" && <button type="button" className="btn-secondary btn-sm" disabled={statusUpdating} onClick={() => updateStatus("closed")}>Đóng</button>}
              </div>
            </div>

            {/* Thread view */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {threads.length === 0 ? <EmptyState icon="💬" message="Chưa có tin nhắn." /> :
               threads.map((t) => {
                const isCustomer = t.sender === "Customer" || t.type === "customer";
                const senderName = t.from || (isCustomer ? "Khách hàng" : t.sender || "Hệ thống");
                return (
                  <div key={t.id} style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", backgroundColor: isCustomer ? "var(--bg-secondary)" : "rgba(159,232,112,0.08)", border: "1px solid var(--border-default)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: "0.75rem" }}>
                      <span style={{ fontWeight: 600, color: isCustomer ? "var(--text-primary)" : "var(--color-wise-dark-green)" }}>{senderName}</span>
                      <span style={{ color: "var(--text-muted)" }}>{new Date(t.createdAt).toLocaleString("vi-VN")}</span>
                    </div>
                    {/* Plain text only — escape HTML, never render as HTML */}
                    <div style={{ fontSize: "0.875rem", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-primary)" }}>{stripHtml(t.body)}</div>
                  </div>
                );
              })}
            </div>

            {/* Reply composer */}
            <div style={{ borderTop: "1px solid var(--border-default)", padding: "12px 20px" }}>
              <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Nhập nội dung reply..." rows={3}
                className="input" style={{ resize: "vertical", marginBottom: 8, fontSize: "0.875rem" }} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="btn-primary btn-sm" disabled={sending || !replyText.trim()} onClick={sendReply}>
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? "Đang gửi…" : "Gửi reply"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Utility: strip HTML tags from thread body (plain text rendering) ── */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

/* ── Shared sub-components ── */
function LoadingState() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  );
}
function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: "2.5rem", marginBottom: 12, opacity: 0.3 }}>⚠️</div>
        <p className="text-body" style={{ color: "var(--text-secondary)" }}>{message}</p>
      </div>
    </div>
  );
}
function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: "2.5rem", marginBottom: 12, opacity: 0.3 }}>{icon}</div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>{message}</p>
      </div>
    </div>
  );
}
