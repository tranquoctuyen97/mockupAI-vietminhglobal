"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus, RefreshCw, Trash2, KeyRound, Store as StoreIcon,
  ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Loader2,
  ArrowLeft, Link as LinkIcon, ShieldCheck, ShieldX, Unplug,
  ExternalLink, Clock, Key, Hash,
} from "lucide-react";
import Link from "next/link";

interface PrintifyShopData {
  id: string;
  externalShopId: number;
  title: string;
  salesChannel: string | null;
  externalDomain: string | null;
  disconnected: boolean;
  stores: Array<{ id: string; name: string; shopifyDomain: string }>;
}

interface PrintifyAccountData {
  id: string;
  nickname: string;
  apiKeyMasked: string;
  status: string;
  lastSyncAt: string | null;
  createdAt: string;
  shops: PrintifyShopData[];
}

/* ─── Channel label mapping ─── */
function channelLabel(raw: string | null): { label: string; color: string; icon: React.ReactNode } {
  if (!raw || raw === "disconnected") {
    return { label: "Chưa kết nối", color: "#94a3b8", icon: <Unplug size={13} /> };
  }
  const map: Record<string, { label: string; color: string }> = {
    shopify: { label: "Shopify", color: "#96bf48" },
    etsy: { label: "Etsy", color: "#f1641e" },
    woocommerce: { label: "WooCommerce", color: "#7f54b3" },
    custom: { label: "Custom", color: "#64748b" },
  };
  const entry = map[raw.toLowerCase()] || { label: raw, color: "#64748b" };
  return { ...entry, icon: <ExternalLink size={13} /> };
}

/* ─── Status helpers ─── */
function statusBadge(status: string) {
  const isActive = status === "ACTIVE";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "2px 8px", borderRadius: 99,
        background: isActive ? "rgba(159,232,112,0.15)" : "rgba(239,68,68,0.12)",
        color: isActive ? "var(--color-wise-green)" : "#ef4444",
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: isActive ? "var(--color-wise-green)" : "#ef4444",
      }} />
      {isActive ? "Active" : status.replace("_", " ")}
    </span>
  );
}

export default function PrintifyIntegrationPage() {
  const [accounts, setAccounts] = useState<PrintifyAccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadAccounts() {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/printify/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
        // Auto-expand if only one
        if (data.length === 1) setExpandedId(data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAccounts(); }, []);

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header */}
      <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
        <Link
          href="/integrations"
          aria-label="Back to integrations"
          style={{
            color: "inherit", opacity: 0.4,
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 8,
            transition: "opacity 0.15s, background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; e.currentTarget.style.background = "var(--bg-inset)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.background = "transparent"; }}
        >
          <ArrowLeft size={18} />
        </Link>
        <div
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(159,232,112,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <StoreIcon size={18} style={{ color: "var(--color-wise-green)" }} />
        </div>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 800, margin: 0, lineHeight: 1.2 }}>Printify Accounts</h1>
          <p style={{ opacity: 0.5, margin: 0, fontSize: "0.82rem", lineHeight: 1.4 }}>
            Quản lý API key ở cấp workspace · Sync shops · Pick shop cho từng store
          </p>
        </div>
      </div>

      {/* Create button */}
      <div style={{ margin: "20px 0" }}>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreate(!showCreate)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={15} /> Kết nối Printify Account
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <CreateAccountForm
          onCreated={() => { setShowCreate(false); loadAccounts(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Accounts List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Loader2 size={28} className="animate-spin" style={{ margin: "0 auto 12px", opacity: 0.4 }} />
          <p style={{ opacity: 0.4, fontSize: "0.85rem" }}>Đang tải accounts...</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="card" style={{ padding: "48px 32px", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
            background: "var(--bg-inset)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <StoreIcon size={28} style={{ opacity: 0.25 }} />
          </div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Chưa có Printify account</p>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 16 }}>
            Bấm &quot;Kết nối Printify Account&quot; để thêm API key và bắt đầu sync shops.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              expanded={expandedId === account.id}
              onToggle={() => setExpandedId(expandedId === account.id ? null : account.id)}
              onRefresh={loadAccounts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ====================== Create Form ====================== */

function CreateAccountForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [nickname, setNickname] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim() || !apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/printify/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim(), apiKey: apiKey.trim() }),
      });
      if (res.ok) {
        toast.success("Kết nối Printify thành công!");
        onCreated();
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi kết nối");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card"
      style={{
        padding: 24, marginBottom: 16,
        borderLeft: "3px solid var(--color-wise-green)",
      }}
    >
      <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: "1rem" }}>
        Kết nối Printify Account mới
      </h3>

      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label htmlFor="pf-nickname" style={{ display: "block", fontWeight: 600, fontSize: "0.82rem", marginBottom: 6, opacity: 0.8 }}>
            Tên gợi nhớ
          </label>
          <input
            id="pf-nickname"
            className="input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="VD: Main Production Account"
            style={{ width: "100%" }}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="pf-apikey" style={{ display: "block", fontWeight: 600, fontSize: "0.82rem", marginBottom: 6, opacity: 0.8 }}>
            Printify API Key
          </label>
          <input
            id="pf-apikey"
            type="password"
            className="input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Nhập Personal Access Token từ Printify"
            style={{ width: "100%" }}
          />
          <p style={{ fontSize: "0.72rem", opacity: 0.45, margin: "5px 0 0" }}>
            Lấy tại: Printify → Account → Connections → Personal Access Token
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ marginTop: 16 }}>
        <button type="submit" className="btn btn-primary" disabled={saving || !nickname.trim() || !apiKey.trim()}>
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Đang kết nối...</>
          ) : (
            "Kết nối & Sync shops"
          )}
        </button>
        <button type="button" className="btn" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  );
}

/* ====================== Account Card ====================== */

function AccountCard({
  account, expanded, onToggle, onRefresh,
}: {
  account: PrintifyAccountData;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRotate, setShowRotate] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/integrations/printify/accounts/${account.id}/sync`, { method: "POST" });
      if (res.ok) {
        toast.success("Đã sync shops thành công!");
        onRefresh();
      } else {
        const err = await res.json();
        toast.error(err.error || "Sync thất bại");
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Xóa account "${account.nickname}"? Hành động này không thể hoàn tác.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/integrations/printify/accounts/${account.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Đã xóa account!");
        onRefresh();
      } else {
        const err = await res.json();
        toast.error(err.error || "Xóa thất bại");
      }
    } finally {
      setDeleting(false);
    }
  }

  const linkedCount = account.shops.filter(s => s.stores.length > 0).length;

  return (
    <div
      className="card"
      style={{
        overflow: "hidden",
        transition: "box-shadow 0.15s",
        ...(expanded ? { boxShadow: "0 4px 20px rgba(0,0,0,0.08)" } : {}),
      }}
    >
      {/* Accordion Header */}
      <button
        onClick={onToggle}
        type="button"
        aria-expanded={expanded}
        style={{
          width: "100%", padding: "16px 20px",
          display: "flex", alignItems: "center", gap: 14,
          background: "none", border: "none", cursor: "pointer",
          color: "inherit", textAlign: "left",
          transition: "background 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-inset)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {/* Status Icon */}
        <div style={{ flexShrink: 0 }}>
          {account.status === "ACTIVE" ? (
            <ShieldCheck size={22} style={{ color: "var(--color-wise-green)" }} />
          ) : (
            <ShieldX size={22} style={{ color: "#ef4444" }} />
          )}
        </div>

        {/* Account Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{account.nickname}</span>
            {statusBadge(account.status)}
          </div>
          <div style={{ fontSize: "0.78rem", opacity: 0.5, marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span className="flex items-center gap-1"><Key size={11} /> {account.apiKeyMasked}</span>
            <span className="flex items-center gap-1"><Hash size={11} /> {account.shops.length} shop(s)</span>
            {linkedCount > 0 && (
              <span className="flex items-center gap-1"><LinkIcon size={11} /> {linkedCount} linked</span>
            )}
            {account.lastSyncAt && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> {new Date(account.lastSyncAt).toLocaleDateString("vi-VN")}
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: expanded ? "var(--bg-inset)" : "transparent",
          transition: "transform 0.2s, background 0.15s",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        }}>
          <ChevronDown size={16} style={{ opacity: 0.5 }} />
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border-default)" }}>
          {/* Actions Bar */}
          <div style={{
            padding: "10px 20px",
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
            background: "var(--bg-inset)",
          }}>
            <ActionButton
              icon={syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              label="Sync shops"
              onClick={handleSync}
              disabled={syncing}
            />
            <ActionButton
              icon={<KeyRound size={13} />}
              label="Rotate key"
              onClick={() => setShowRotate(!showRotate)}
              active={showRotate}
            />
            <div style={{ flex: 1 }} />
            <ActionButton
              icon={deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              label="Xóa account"
              onClick={handleDelete}
              disabled={deleting}
              danger
            />
          </div>

          {/* Rotate Key Form */}
          {showRotate && (
            <div style={{ padding: "0 20px" }}>
              <RotateKeyForm
                accountId={account.id}
                onDone={() => { setShowRotate(false); onRefresh(); }}
                onCancel={() => setShowRotate(false)}
              />
            </div>
          )}

          {/* Shops List */}
          <div style={{ padding: "16px 20px" }}>
            {account.shops.length === 0 ? (
              <div style={{ padding: "24px 0", textAlign: "center" }}>
                <Unplug size={24} style={{ margin: "0 auto 8px", opacity: 0.2 }} />
                <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: 0 }}>
                  Không có shop nào. Bấm &quot;Sync shops&quot; để cập nhật từ Printify.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.45, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                  Shops ({account.shops.length})
                </div>
                {account.shops.map((shop) => (
                  <ShopRow key={shop.id} shop={shop} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== Shop Row ====================== */

function ShopRow({ shop }: { shop: PrintifyShopData }) {
  const ch = channelLabel(shop.salesChannel);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px", borderRadius: 10,
        background: "var(--bg-inset)",
        transition: "background 0.12s",
      }}
    >
      {/* Shop info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{shop.title}</span>
          <span style={{
            fontSize: "0.68rem", opacity: 0.4, fontFamily: "monospace",
          }}>
            #{shop.externalShopId}
          </span>
        </div>

        {/* Channel badge */}
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: "0.7rem", fontWeight: 500,
              padding: "1px 7px", borderRadius: 99,
              background: `${ch.color}18`,
              color: ch.color,
            }}
          >
            {ch.icon} {ch.label}
          </span>
          {shop.externalDomain && (
            <span style={{ fontSize: "0.72rem", opacity: 0.4 }}>{shop.externalDomain}</span>
          )}
        </div>
      </div>

      {/* Linked Store */}
      <div style={{ minWidth: 120, textAlign: "right" }}>
        {shop.stores.length > 0 ? (
          shop.stores.map((s) => (
            <Link
              key={s.id}
              href={`/stores/${s.id}/config`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                color: "var(--color-wise-green)", textDecoration: "none",
                fontSize: "0.8rem", fontWeight: 500,
                padding: "2px 8px", borderRadius: 6,
                background: "rgba(159,232,112,0.1)",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(159,232,112,0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(159,232,112,0.1)"; }}
            >
              <LinkIcon size={11} /> {s.name}
            </Link>
          ))
        ) : (
          <span style={{
            fontSize: "0.75rem", opacity: 0.35, fontStyle: "italic",
          }}>
            Chưa gắn store
          </span>
        )}
      </div>

      {/* Status */}
      <div style={{ flexShrink: 0 }}>
        {shop.disconnected ? (
          <span
            title="Shop đã bị ngắt trên Printify"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: "0.72rem", fontWeight: 500,
              padding: "2px 8px", borderRadius: 99,
              background: "rgba(239,68,68,0.1)",
              color: "#ef4444",
            }}
          >
            <AlertTriangle size={12} /> Mất kết nối
          </span>
        ) : (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: "0.72rem", fontWeight: 500,
              padding: "2px 8px", borderRadius: 99,
              background: "rgba(159,232,112,0.12)",
              color: "var(--color-wise-green)",
            }}
          >
            <CheckCircle2 size={12} /> OK
          </span>
        )}
      </div>
    </div>
  );
}

/* ====================== Action Button ====================== */

function ActionButton({
  icon, label, onClick, disabled, danger, active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 10px", borderRadius: 6,
        fontSize: "0.78rem", fontWeight: 500,
        border: "1px solid var(--border-default)",
        background: active ? "rgba(159,232,112,0.1)" : "transparent",
        color: danger ? "#ef4444" : "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = danger
            ? "rgba(239,68,68,0.08)"
            : "rgba(159,232,112,0.1)";
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = active ? "rgba(159,232,112,0.1)" : "transparent";
        }
      }}
    >
      {icon} {label}
    </button>
  );
}

/* ====================== Rotate Key Form ====================== */

function RotateKeyForm({ accountId, onDone, onCancel }: { accountId: string; onDone: () => void; onCancel: () => void }) {
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleRotate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/integrations/printify/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: newKey.trim() }),
      });
      if (res.ok) {
        toast.success("Key đã được rotate thành công!");
        onDone();
      } else {
        const err = await res.json();
        toast.error(err.error || "Rotate thất bại");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleRotate}
      style={{
        padding: "14px 16px", margin: "8px 0 0",
        borderRadius: 8, background: "var(--bg-inset)",
        border: "1px dashed var(--border-default)",
      }}
    >
      <label htmlFor="rotate-key" style={{ display: "block", fontWeight: 600, fontSize: "0.78rem", marginBottom: 6, opacity: 0.7 }}>
        New API Key
      </label>
      <input
        id="rotate-key"
        type="password"
        className="input"
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
        placeholder="Nhập API key mới để thay thế"
        style={{ width: "100%", marginBottom: 10 }}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={saving || !newKey.trim()} style={{ fontSize: "0.8rem" }}>
          {saving ? <><Loader2 size={13} className="animate-spin" /> Kiểm tra...</> : "Test & Rotate"}
        </button>
        <button type="button" className="btn" onClick={onCancel} style={{ fontSize: "0.8rem" }}>Hủy</button>
      </div>
    </form>
  );
}
