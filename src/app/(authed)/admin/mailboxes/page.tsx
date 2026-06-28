"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Info,
  Lightbulb,
  Loader2,
  Mail,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CreateMailboxModal } from "./CreateMailboxModal";
import { EditMailboxModal } from "./EditMailboxModal";
import { MailboxList } from "./MailboxList";

export interface MailboxRow {
  id: string;
  name: string;
  email: string;
  provider: string;
  rtQueueId: number | null;
  syncStatus: "PROVISIONING" | "ACTIVE" | "DEGRADED" | "DISABLED";
  lastSyncAt: string | null;
  lastSyncErrorCode: string | null;
  isActive: boolean;
  storeId: string;
  createdAt: string;
}

interface StoreOption {
  id: string;
  name: string;
  domain: string;
}

export default function AdminMailboxesPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storesLoading, setStoresLoading] = useState(true);
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editMailbox, setEditMailbox] = useState<MailboxRow | null>(null);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);
  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? null;

  // Load active stores
  useEffect(() => {
    fetch("/api/stores")
      .then((res) => res.json())
      .then((data) => {
        // listStores returns array; extract id+name, filter active+not deleted
        const storesList = Array.isArray(data) ? data : (data.stores ?? []);
        setStores(
          storesList.map((s: { id: string; name: string; shopifyDomain?: string }) => ({
            id: s.id,
            name: s.name,
            domain: s.shopifyDomain ?? s.id,
          })),
        );
        setSelectedStoreId((current) => current ?? storesList[0]?.id ?? null);
      })
      .catch(() => toast.error("Không thể tải danh sách store"))
      .finally(() => setStoresLoading(false));
  }, []);

  const fetchMailboxes = useCallback(async () => {
    if (!selectedStoreId) {
      setMailboxes([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/mailboxes?storeId=${encodeURIComponent(selectedStoreId)}`,
      );
      const data = await res.json();
      if (res.ok) {
        setMailboxes(data.mailboxes);
        setStoreName(data.store?.name ?? null);
      } else {
        toast.error(data.error || "Không thể tải danh sách mailbox");
      }
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId]);

  function handleStoreChange(storeId: string) {
    setSelectedStoreId(storeId);
    setStoreName(null);
    setStoreSwitcherOpen(false);
  }

  useEffect(() => {
    fetchMailboxes();
  }, [fetchMailboxes]);

  const handleDelete = async (mailbox: MailboxRow) => {
    if (
      !window.confirm(
        `Bạn có chắc muốn XOÁ mailbox '${mailbox.name}' (${mailbox.email})?\n\nHành động này không thể hoàn tác. Toàn bộ dữ liệu mailbox sẽ bị xoá khỏi database.`,
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/mailboxes/${mailbox.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Đã xoá mailbox '${mailbox.name}'`);
        fetchMailboxes();
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi xoá mailbox");
      }
    } catch {
      toast.error("Lỗi kết nối");
    }
  };

  const handleToggleStatus = async (mailbox: MailboxRow) => {
    if (mailbox.isActive) {
      if (
        !window.confirm(
          `Bạn có chắc muốn tắt mailbox '${mailbox.name}'? Email sẽ không được đồng bộ nữa.`,
        )
      ) {
        return;
      }
    }

    try {
      const res = await fetch(`/api/admin/mailboxes/${mailbox.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !mailbox.isActive }),
      });
      if (res.ok) {
        toast.success(mailbox.isActive ? "Đã tắt mailbox" : "Đã bật mailbox");
        fetchMailboxes();
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi thay đổi trạng thái");
      }
    } catch {
      toast.error("Lỗi kết nối");
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1440, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
          <Mail size={26} style={{ marginTop: 5 }} />
          <div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 800, margin: 0, color: "#101828" }}>
              Mailbox Config
            </h1>
            <p style={{ margin: "0.5rem 0 0", color: "#667085", fontSize: "1rem" }}>
              Configure support mailboxes by store
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              style={storeSwitcherButton}
              onClick={() => setStoreSwitcherOpen((value) => !value)}
            >
              <StoreAvatar name={selectedStore?.name ?? "Store"} />
              <strong>{selectedStore?.name ?? "Choose store"}</strong>
              {selectedStore && <span style={activeBadge}>Active</span>}
              <span style={summaryBadge}>
                {selectedStore ? `${mailboxes.length} mailboxes` : `${stores.length} stores`}
              </span>
              <ChevronDown size={16} />
            </button>
            {storeSwitcherOpen && (
              <StoreSwitcherPanel
                stores={stores}
                selectedStore={selectedStore}
                storesLoading={storesLoading}
                onChooseStore={handleStoreChange}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            disabled={!selectedStoreId}
            style={{
              ...createButton,
              background: selectedStoreId ? "linear-gradient(180deg, #45b832, #2f9e24)" : "#e5e7eb",
              color: selectedStoreId ? "#fff" : "#9ca3af",
              cursor: selectedStoreId ? "pointer" : "not-allowed",
            }}
          >
            <Plus size={16} /> Tạo mailbox
          </button>
          <button type="button" style={helpButton} aria-label="Mailbox config help">
            <HelpCircle size={20} />
          </button>
        </div>
      </div>

      {!selectedStoreId ? (
        <NoStoreSelectedConfig storesLoading={storesLoading} />
      ) : loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
          <Loader2 size={32} className="animate-spin" />
        </div>
      ) : (
        <MailboxList
          mailboxes={mailboxes}
          storeName={storeName}
          onEdit={setEditMailbox}
          onToggleStatus={handleToggleStatus}
          onDelete={handleDelete}
          onCreate={() => setShowCreate(true)}
        />
      )}

      {showCreate && selectedStoreId && (
        <CreateMailboxModal
          storeId={selectedStoreId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchMailboxes();
          }}
        />
      )}

      {editMailbox && (
        <EditMailboxModal
          mailbox={editMailbox}
          onClose={() => setEditMailbox(null)}
          onUpdated={() => {
            setEditMailbox(null);
            fetchMailboxes();
          }}
        />
      )}
    </div>
  );
}

function StoreSwitcherPanel({
  stores,
  selectedStore,
  storesLoading,
  onChooseStore,
}: {
  stores: StoreOption[];
  selectedStore: StoreOption | null;
  storesLoading: boolean;
  onChooseStore: (storeId: string) => void;
}) {
  const recentStores = stores.slice(0, 3);
  const allStores = stores.slice(3, 8);

  return (
    <div style={storePanel}>
      <div style={storeSearch}>
        <Search size={16} />
        <span>Search stores...</span>
      </div>
      {storesLoading ? (
        <div style={panelEmpty}>
          <Loader2 size={16} className="animate-spin" />
          Loading stores...
        </div>
      ) : stores.length === 0 ? (
        <div style={panelEmpty}>No active stores yet.</div>
      ) : (
        <>
          <PanelLabel>Recent stores</PanelLabel>
          {recentStores.map((store, index) => (
            <StoreRow
              key={store.id}
              store={store}
              index={index}
              selected={store.id === selectedStore?.id}
              onChooseStore={onChooseStore}
            />
          ))}
          {allStores.length > 0 && <PanelLabel>All stores</PanelLabel>}
          {allStores.map((store, index) => (
            <StoreRow
              key={store.id}
              store={store}
              index={index + 3}
              selected={store.id === selectedStore?.id}
              onChooseStore={onChooseStore}
            />
          ))}
        </>
      )}
      <Link href="/stores" style={viewAllStores}>
        View all stores <ChevronRight size={15} />
      </Link>
    </div>
  );
}

function StoreRow({
  store,
  index,
  selected,
  onChooseStore,
}: {
  store: StoreOption;
  index: number;
  selected: boolean;
  onChooseStore: (storeId: string) => void;
}) {
  return (
    <button
      type="button"
      style={{ ...storeRow, background: selected ? "#f0faec" : "transparent" }}
      onClick={() => onChooseStore(store.id)}
    >
      <StoreAvatar name={store.name} index={index} />
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: "block", color: "#101828", fontSize: 13 }}>{store.name}</strong>
        <span style={storeDomain}>{store.domain}</span>
      </span>
      <span style={activeBadge}>Active</span>
      {selected ? <Check size={16} color="#35a527" /> : <ChevronRight size={15} color="#98a2b3" />}
    </button>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <div style={panelLabel}>{children}</div>;
}

function StoreAvatar({ name, index = 0 }: { name: string; index?: number }) {
  const colors = ["#101828", "#ff5c8a", "#d9a15f", "#344054", "#35a527"];
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span style={{ ...storeAvatar, background: colors[index % colors.length] }}>
      {initials || "ST"}
    </span>
  );
}

function NoStoreSelectedConfig({ storesLoading }: { storesLoading: boolean }) {
  return (
    <>
      <OnboardingStrip />
      <div style={configGrid}>
        <section style={emptyCard}>
          <MailboxIllustration />
          <h2
            style={{
              margin: "1.5rem 0 0.75rem",
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "#101828",
            }}
          >
            Chọn store để cấu hình mailbox
          </h2>
          <p style={emptyText}>
            Mỗi store có thể kết nối và quản lý nhiều mailbox hỗ trợ.
            <br />
            Vui lòng chọn store ở góc trên bên phải trước khi bắt đầu.
          </p>
          {storesLoading ? (
            <div style={loadingSelect}>
              <Loader2 size={18} className="animate-spin" />
              Đang tải stores...
            </div>
          ) : (
            <div style={loadingSelect}>
              <Store size={18} style={{ color: "#35a527", flexShrink: 0 }} />
              Use the store switcher in the header
            </div>
          )}
        </section>
        <aside style={infoPanel}>
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "flex-start",
              marginBottom: "1.5rem",
            }}
          >
            <span style={infoIcon}>
              <Mail size={22} />
            </span>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800 }}>
                Mailbox Config là gì?
              </h2>
              <p style={{ margin: "0.5rem 0 0", color: "#475467", lineHeight: 1.5 }}>
                Quản lý mailbox hỗ trợ khách hàng cho từng store.
              </p>
            </div>
          </div>
          <InfoRow icon={<Users size={22} />} title="Tập trung hỗ trợ khách hàng">
            Quản lý tất cả email hỗ trợ của store ở một nơi duy nhất.
          </InfoRow>
          <InfoRow icon={<ShieldCheck size={22} />} title="Inbox riêng cho từng store">
            Giữ các cuộc trò chuyện và cài đặt riêng biệt theo từng store.
          </InfoRow>
          <InfoRow icon={<Zap size={22} />} title="Truy cập nhanh & hiệu quả">
            Xem nhanh trạng thái, số lượng chưa đọc và cuộc hội thoại gần đây.
          </InfoRow>
          <InfoRow icon={<Settings size={22} />} title="Dễ dàng kết nối & quản lý">
            Kết nối mailbox mới hoặc cập nhật cài đặt chỉ với vài thao tác.
          </InfoRow>
          <div style={tipBox}>
            <Lightbulb size={20} />
            <span>
              Mẹo: Các cài đặt chi tiết có thể được tìm thấy trong{" "}
              <strong>Mailboxes / Mailbox settings</strong>.
            </span>
          </div>
        </aside>
      </div>
      <div style={footerHint}>
        <Info size={18} />
        <span>
          Bạn cần thêm store trước? Vào{" "}
          <a href="/stores" style={footerLink}>
            Stores
          </a>{" "}
          để thêm store mới.
        </span>
      </div>
    </>
  );
}

function OnboardingStrip() {
  const steps = [
    {
      icon: <Store size={30} />,
      title: "Chọn store",
      text: "Chọn store bạn muốn cấu hình mailbox hỗ trợ khách hàng.",
    },
    {
      icon: <Mail size={30} />,
      title: "Xem trạng thái mailbox",
      text: "Xem các mailbox đang hoạt động và trạng thái kết nối của store.",
    },
    {
      icon: <Settings size={30} />,
      title: "Kết nối hoặc quản lý mailbox",
      text: "Kết nối mailbox mới hoặc quản lý cấu hình mailbox hiện có.",
    },
  ];

  return (
    <section style={onboardingCard}>
      {steps.map((step, index) => (
        <div key={step.title} style={stepItem}>
          <span style={stepNumber}>{index + 1}</span>
          <span style={stepIcon}>{step.icon}</span>
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>{step.title}</h3>
            <p style={{ margin: "0.5rem 0 0", color: "#667085", lineHeight: 1.55 }}>{step.text}</p>
          </div>
          {index < steps.length - 1 && (
            <ArrowRight size={28} style={{ marginLeft: "auto", color: "#98a2b3" }} />
          )}
        </div>
      ))}
    </section>
  );
}

function InfoRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={infoRow}>
      <span style={roundIcon}>{icon}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>{title}</h3>
        <p style={{ margin: "0.5rem 0 0", color: "#475467", lineHeight: 1.55 }}>{children}</p>
      </div>
    </div>
  );
}

function MailboxIllustration() {
  return (
    <div style={illustration}>
      <div style={mailboxBox}>
        <Mail size={58} />
        <span style={flagPole} />
        <span style={flag} />
      </div>
    </div>
  );
}

const createButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.75rem 1.25rem",
  borderRadius: 10,
  border: "none",
  fontWeight: 700,
  fontSize: "0.9rem",
};

const storeSwitcherButton: React.CSSProperties = {
  minHeight: 44,
  border: "1px solid #6abd5a",
  borderRadius: 10,
  background: "#fff",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
  boxShadow: "0 10px 24px rgba(16, 24, 40, 0.04)",
  cursor: "pointer",
  color: "#101828",
};

const storeAvatar: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
};

const activeBadge: React.CSSProperties = {
  border: "1px solid #b7e4b2",
  background: "#ecfdf3",
  color: "#2f7d32",
  borderRadius: 7,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 600,
};

const summaryBadge: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  background: "#f8fafc",
  color: "#475467",
  borderRadius: 7,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 600,
};

const storePanel: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 54,
  width: 390,
  zIndex: 20,
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  background: "#fff",
  padding: 12,
  boxShadow: "0 24px 60px rgba(16, 24, 40, 0.16)",
};

const storeSearch: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  color: "#98a2b3",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  fontSize: 13,
};

const panelLabel: React.CSSProperties = {
  margin: "14px 0 6px",
  color: "#667085",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const panelEmpty: React.CSSProperties = {
  minHeight: 74,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  color: "#667085",
  fontSize: 13,
};

const storeRow: React.CSSProperties = {
  width: "100%",
  minHeight: 58,
  border: "none",
  borderRadius: 10,
  display: "grid",
  gridTemplateColumns: "30px minmax(0, 1fr) auto 18px",
  gap: 10,
  alignItems: "center",
  padding: "8px 10px",
  textAlign: "left",
  cursor: "pointer",
};

const storeDomain: React.CSSProperties = {
  display: "block",
  color: "#667085",
  marginTop: 2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
};

const viewAllStores: React.CSSProperties = {
  minHeight: 40,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 6,
  color: "#475467",
  textDecoration: "none",
  borderTop: "1px solid #eef0f3",
  marginTop: 8,
  paddingTop: 10,
  fontSize: 13,
  fontWeight: 600,
};

const helpButton: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: "1px solid #d9dee7",
  background: "#fff",
  color: "#475467",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const onboardingCard: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "1.5rem",
  padding: "2rem",
  border: "1px solid #dfe4ea",
  borderRadius: 18,
  background: "#fff",
  boxShadow: "0 18px 38px rgba(16, 24, 40, 0.06)",
  marginBottom: "1.5rem",
};

const stepItem: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "30px 74px minmax(0, 1fr) auto",
  gap: "1rem",
  alignItems: "center",
};

const stepNumber: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "#e9f8e3",
  color: "#2f7d32",
  fontWeight: 800,
};

const stepIcon: React.CSSProperties = {
  width: 74,
  height: 74,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "#f2f4f7",
  color: "#475467",
};

const configGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 420px",
  gap: "1.5rem",
};

const emptyCard: React.CSSProperties = {
  minHeight: 590,
  border: "1px solid #dfe4ea",
  borderRadius: 18,
  background: "#fff",
  boxShadow: "0 18px 38px rgba(16, 24, 40, 0.06)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "3rem",
};

const emptyText: React.CSSProperties = {
  margin: 0,
  color: "#667085",
  fontSize: "1rem",
  lineHeight: 1.7,
};

const loadingSelect: React.CSSProperties = {
  marginTop: "2rem",
  minHeight: 58,
  width: "100%",
  maxWidth: 430,
  border: "1px solid #d9dee7",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.625rem",
  color: "#667085",
};

const infoPanel: React.CSSProperties = {
  border: "1px solid #d8efce",
  borderRadius: 18,
  background: "linear-gradient(135deg, #fbfff8, #ffffff)",
  boxShadow: "0 18px 38px rgba(16, 24, 40, 0.05)",
  padding: "2rem",
};

const infoIcon: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 10,
  background: "#e9f8e3",
  color: "#35a527",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};

const infoRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "48px minmax(0, 1fr)",
  gap: "1rem",
  padding: "1.25rem 0",
  borderTop: "1px solid #e5efdf",
};

const roundIcon: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  background: "#e9f8e3",
  color: "#35a527",
  display: "grid",
  placeItems: "center",
};

const tipBox: React.CSSProperties = {
  marginTop: "1.5rem",
  border: "1px solid #d7eecf",
  borderRadius: 12,
  background: "#eff9eb",
  color: "#475467",
  padding: "1rem",
  display: "flex",
  alignItems: "center",
  gap: "0.875rem",
  lineHeight: 1.55,
};

const footerHint: React.CSSProperties = {
  marginTop: "2rem",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "0.75rem",
  color: "#667085",
};

const footerLink: React.CSSProperties = {
  color: "#2f7d32",
  fontWeight: 700,
  textDecoration: "underline",
};

const illustration: React.CSSProperties = {
  width: 320,
  height: 180,
  display: "grid",
  placeItems: "center",
  borderRadius: 999,
  background: "radial-gradient(circle, #e9f8e3 0 48%, transparent 49%)",
  color: "#35a527",
  position: "relative",
};

const mailboxBox: React.CSSProperties = {
  width: 150,
  height: 100,
  border: "3px solid #98a2b3",
  borderRadius: "48px 48px 10px 10px",
  display: "grid",
  placeItems: "center",
  background: "#f8fafc",
  position: "relative",
  boxShadow: "0 22px 26px rgba(16, 24, 40, 0.08)",
};

const flagPole: React.CSSProperties = {
  position: "absolute",
  right: 28,
  top: -42,
  width: 3,
  height: 52,
  background: "#98a2b3",
};

const flag: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: -42,
  width: 24,
  height: 24,
  borderRadius: "2px 8px 8px 2px",
  background: "#7bd957",
  border: "2px solid #5a9f45",
};
