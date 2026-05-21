"use client";

import React, { useEffect, useState, useMemo, useCallback, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Palette,
  Save,
  Package,
  Move,
  Link2,
  Ruler,
  Trash2,
  Copy,
  Star,
  Plus,
  Search,
  Edit,
  Truck,
  Image,
} from "lucide-react";
import Link from "next/link";
import { MultiViewPlacementEditor } from "@/components/placement/MultiViewPlacementEditor";
import type { PlacementData } from "@/lib/placement/types";
import {
  formatPlacementViewCount,
  formatPlacementViewDetails,
  normalizePlacementData,
  getEnabledViews,
  createPlacementDataWithFront,
  VIEW_LABELS,
} from "@/lib/placement/views";

interface TemplateDetail {
  id: string;
  name: string;
  printifyBlueprintId: number;
  printifyPrintProviderId: number;
  blueprintTitle: string;
  printProviderTitle: string;
  enabledVariantIds: number[];
  enabledSizes: string[];
  position: "FRONT" | "BACK" | "SLEEVE";
  defaultPlacement: unknown;
  defaultAspectRatio: string;
  storePresetSnapshot: unknown;
  isDefault: boolean;
  sortOrder: number;
  defaultMockupSource: "PRINTIFY" | "CUSTOM";
  blueprintImageUrl?: string | null;
  blueprintBrand?: string | null;
  colors: Array<{
    id: string;
    templateId: string;
    colorId: string;
    color: {
      id: string;
      name: string;
      hex: string;
    };
  }>;
}

interface StoreDetail {
  id: string;
  name: string;
  shopifyDomain: string;
  printifyShopId: string | null;
  printifyShopTitle?: string;
  status: string;
  defaultPriceUsd: number | string;
  publishMode: string;
  colors: Array<{ id: string; name: string; hex: string; printifyColorId: string | null; enabled: boolean; sortOrder: number }>;
  templates: TemplateDetail[];
  presetStatus: {
    ready: boolean;
    missing: string[];
    completionPercent: number;
  };
}

interface VariantGroup {
  color: string;
  colorHex: string;
  printifyColorId: string;
  sizes: string[];
  variants: Array<{ id: number; title: string; options: Record<string, string> }>;
}

interface SizeOption {
  size: string;
  availableColors: number;
  isAvailable: boolean;
  costCents: number;
  costDeltaCents: number;
}

type Tab = "printify" | "templates" | "overview";
type TemplateMissing = "blueprint" | "provider" | "variants" | "colors" | "placement";

const TEMPLATE_MISSING_LABELS: Record<TemplateMissing, string> = {
  blueprint: "Blueprint",
  provider: "Provider",
  variants: "Variants",
  colors: "Colors",
  placement: "Placement",
};

function getTemplateMissing(template: TemplateDetail): TemplateMissing[] {
  const missing: TemplateMissing[] = [];
  if (!template.printifyBlueprintId) missing.push("blueprint");
  if (!template.printifyPrintProviderId) missing.push("provider");
  if (!template.enabledVariantIds?.length) missing.push("variants");
  if (!template.colors?.length) missing.push("colors");
  if (getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length === 0) {
    missing.push("placement");
  }
  return missing;
}

function formatTemplateMissingLabels(missing: TemplateMissing[]): string {
  return missing.map((key) => TEMPLATE_MISSING_LABELS[key]).join(", ");
}

/* ========== Tab status helpers ========== */
function getTabStatus(store: StoreDetail, tab: Tab): "done" | "warn" | "none" {
  switch (tab) {
    case "printify": return store.printifyShopId ? "done" : "warn";
    case "templates": return (store.templates.length > 0 && store.presetStatus.ready) ? "done" : "warn";
    case "overview": return "none";
  }
}

function getFirstIncompleteTab(store: StoreDetail): Tab {
  if (!store.printifyShopId) return "printify";
  if (store.templates.length === 0 || !store.presetStatus.ready) return "templates";
  return "overview";
}

const TABS: { key: Tab; label: string; icon: typeof Link2 }[] = [
  { key: "printify", label: "Printify", icon: Link2 },
  { key: "templates", label: "Templates", icon: Package },
  { key: "overview", label: "Tổng quan", icon: RefreshCw },
];

function StoreConfigContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const storeId = params.id as string;
  const justConnected = searchParams.get("connected");

  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("printify");

  const fetchStore = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const res = await fetch("/api/stores");
      if (res.ok) {
        const stores = await res.json();
        const found = stores.find((s: StoreDetail) => s.id === storeId);
        setStore(found || null);
        return found;
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
    return null;
  }, [storeId]);

  useEffect(() => {
    fetchStore().then((s: StoreDetail | null) => {
      if (justConnected === "shopify") toast.success("Shopify đã kết nối thành công!");
      if (!s) return;
      setActiveTab(getFirstIncompleteTab(s));
    });
  }, []);

  function refreshAndGoTo(tab: Tab) {
    fetchStore({ silent: true }).then(() => setActiveTab(tab));
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto" }} />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <p>Store không tồn tại</p>
        <Link href="/stores" className="btn btn-secondary" style={{ marginTop: 16 }}>Quay lại</Link>
      </div>
    );
  }

  const ps = store.presetStatus;
  const total = 5;
  const done = total - ps.missing.length;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", minHeight: "calc(100vh - 80px)" }}>
      {/* Header */}
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <Link href="/stores" style={{ opacity: 0.5 }}><ArrowLeft size={18} /></Link>
        <h1 className="page-title" style={{ margin: 0 }}>{store.name}</h1>
        <span className="badge badge-success" style={{ fontSize: "0.7rem" }}>{store.shopifyDomain}</span>
      </div>

      {/* Progress bar — single source of truth (Fix F1/F9) */}
      <div style={{ marginBottom: 20, marginTop: 8 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: "0.78rem", opacity: 0.5 }}>
            {ps.ready ? "Sẵn sàng tạo listing" : `${done}/${total} phần đã hoàn thành`}
          </span>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: ps.ready ? "var(--color-wise-green)" : "#f59e0b" }}>
            {ps.completionPercent}%
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: "var(--bg-inset)" }}>
          <div style={{ height: "100%", borderRadius: 2, width: `${ps.completionPercent}%`, background: ps.ready ? "var(--color-wise-green)" : "#f59e0b", transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Tab bar — free navigation, status badges (Fix F2/F3/F5) */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderBottom: "2px solid var(--border-default)",
          marginBottom: 24,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {TABS.map((tab) => {
          const status = getTabStatus(store, tab.key);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1"
              style={{
                padding: "10px 16px",
                fontWeight: isActive ? 700 : 500,
                fontSize: "0.84rem",
                borderBottom: isActive ? "2px solid var(--color-wise-green)" : "2px solid transparent",
                marginBottom: -2,
                backgroundColor: "transparent",
                cursor: "pointer",
                opacity: isActive ? 1 : 0.6,
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {status === "done" && <CheckCircle2 size={13} style={{ color: "var(--color-wise-green)" }} />}
              {status === "warn" && <AlertTriangle size={13} style={{ color: "#f59e0b" }} />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "printify" && <PrintifySection store={store} onSave={() => refreshAndGoTo("templates")} />}
      {activeTab === "templates" && <TemplatesSection store={store} onRefreshStore={fetchStore} />}
      {activeTab === "overview" && <OverviewTab store={store} onRefresh={fetchStore} onGoToTab={setActiveTab} />}
    </div>
  );
}

export default function StoreConfigPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 60 }}><Loader2 size={24} className="animate-spin" style={{ margin: "0 auto" }} /></div>}>
      <StoreConfigContent />
    </Suspense>
  );
}

/* ========== Tổng quan Tab — connection info + inline test (Fix F2/F6/F8) ========== */
function OverviewTab({
  store,
  onRefresh,
  onGoToTab,
}: {
  store: StoreDetail;
  onRefresh: () => void;
  onGoToTab: (tab: Tab) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ shopify?: { ok: boolean; error?: string }; printify?: { ok: boolean; error?: string } } | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/stores/${store.id}/test-connection`, { method: "POST" });
      const r = await res.json();
      setResult(r);
      if (r.status === "ACTIVE") toast.success("Tất cả kết nối hoạt động tốt!");
      else toast.error("Có lỗi kết nối — xem chi tiết bên dưới");
      onRefresh();
    } finally { setTesting(false); }
  }

  const statusLabel = store.status === "ACTIVE" ? "Hoạt động" : store.status === "TOKEN_EXPIRED" ? "Token hết hạn" : store.status;

  return (
    <div>
      <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Thông tin kết nối</h3>

      {/* Shopify row */}
      <div className="card" style={{ padding: "16px 20px", marginBottom: 12 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Shopify</span>
            <span style={{ fontSize: "0.8rem", opacity: 0.5 }}>{store.shopifyDomain}</span>
          </div>
          <span className={`badge ${store.status === "ACTIVE" ? "badge-success" : "badge-warning"}`} style={{ fontSize: "0.72rem" }}>
            {statusLabel}
          </span>
        </div>
        {result?.shopify && !result.shopify.ok && (
          <div style={{ fontSize: "0.8rem", color: "#ef4444", marginTop: 8 }}>Lỗi: {result.shopify.error}</div>
        )}
      </div>

      {/* Printify row */}
      <div className="card" style={{ padding: "16px 20px", marginBottom: 16 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Printify</span>
            <span style={{ fontSize: "0.8rem", opacity: 0.5 }}>
              {store.printifyShopTitle || (store.printifyShopId ? `Shop #${store.printifyShopId}` : "Chưa kết nối")}
            </span>
          </div>
          {store.printifyShopId ? (
            <span className="badge badge-success" style={{ fontSize: "0.72rem" }}>Đã kết nối</span>
          ) : (
            <span className="badge badge-warning" style={{ fontSize: "0.72rem" }}>Chưa kết nối</span>
          )}
        </div>
        {result?.printify && !result.printify.ok && (
          <div style={{ fontSize: "0.8rem", color: "#ef4444", marginTop: 8 }}>Lỗi: {result.printify.error}</div>
        )}
      </div>

      <button onClick={handleTest} disabled={testing} className="btn btn-secondary" style={{ marginBottom: 24 }}>
        {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Kiểm tra kết nối
      </button>

      {/* Templates Section in Overview Tab */}
      <div style={{ marginTop: 24 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-2">
            <h3 style={{ fontWeight: 700, margin: 0 }}>Templates</h3>
            <span className="badge badge-success" style={{ fontSize: "0.72rem" }}>{store.templates.length}</span>
          </div>
          <button onClick={() => onGoToTab("templates")} className="btn btn-secondary" style={{ fontSize: "0.8rem" }}>
            Quản lý templates
          </button>
        </div>
        
        {store.templates.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>
            Chưa có template nào được cấu hình.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            {store.templates.map((t) => {
              const colorsCount = t.colors?.length ?? 0;
              const sizesCount = t.enabledSizes?.length ?? 0;
              const placementCount = getEnabledViews(normalizePlacementData(t.defaultPlacement, false)).length;
              
              return (
                <div key={t.id} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                      <div className="flex items-center gap-2">
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg-inset)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase" }}>
                          {t.name[0] || "T"}
                        </div>
                        <div>
                          <div className="flex items-center gap-1" style={{ flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{t.name}</span>
                            {t.isDefault && <span className="badge badge-success" style={{ fontSize: "0.6rem", marginLeft: 6 }}>DEFAULT</span>}
                            {t.defaultMockupSource === "CUSTOM" ? (
                              <span style={{ padding: "1px 8px", borderRadius: 9999, background: "rgba(159,232,112,0.18)", color: "#054d28", fontSize: 11, fontWeight: 700 }}>Custom</span>
                            ) : (
                              <span style={{ padding: "1px 8px", borderRadius: 9999, background: "var(--bg-inset)", color: "var(--text-secondary)", fontSize: 11, fontWeight: 700 }}>Printify</span>
                            )}
                          </div>
                          {t.defaultMockupSource === "CUSTOM" && (
                            <Link
                              href={`/stores/${store.id}/mockup-library`}
                              style={{ fontSize: "0.72rem", color: "var(--color-wise-green)", fontWeight: 500 }}
                            >
                              Thư viện mockup →
                            </Link>
                          )}
                        </div>
                      </div>
                      {/* Decorative toggle */}
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <div style={{ width: 32, height: 18, borderRadius: 9, background: t.isDefault ? "var(--color-wise-green)" : "#cbd5e1", padding: 2, display: "flex", justifyContent: t.isDefault ? "flex-end" : "flex-start", cursor: "not-allowed" }}>
                          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
                        </div>
                      </div>
                    </div>
                    <p style={{ fontSize: "0.8rem", opacity: 0.6, margin: 0 }}>
                      {t.blueprintTitle || "Chưa cấu hình blueprint"}
                    </p>
                    <p style={{ fontSize: "0.75rem", opacity: 0.4, margin: "4px 0 0 0" }}>
                      {colorsCount} màu · {sizesCount} sizes · {placementCount} placements
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== Printify Tab — Link a Printify shop to this store ========== */
function PrintifySection({ store, onSave }: { store: StoreDetail; onSave: () => void }) {
  const [shops, setShops] = useState<Array<{ id: string; title: string; externalShopId: number; account: { nickname: string } }>>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/integrations/printify/shops?available=true")
      .then(async r => {
        if (!r.ok) throw new Error("Lỗi tải danh sách shop");
        const d = await r.json();
        setShops(Array.isArray(d) ? d : d.shops || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleLink() {
    if (!selectedShopId) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/printify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printifyShopId: selectedShopId }),
      });
      if (res.ok) {
        toast.success("Đã kết nối Printify shop!");
        onSave();
      } else {
        const e = await res.json();
        toast.error(e.error || "Lỗi kết nối");
      }
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink() {
    setLinking(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/printify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printifyShopId: null }),
      });
      if (res.ok) {
        toast.success("Đã ngắt kết nối Printify");
        onSave();
      }
    } finally {
      setLinking(false);
    }
  }

  // Already linked
  if (store.printifyShopId) {
    return (
      <div>
        <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Printify Shop</h3>
        <div className="card" style={{ padding: 24 }}>
          <div className="flex items-center justify-between">
            <div>
              <div style={{ fontWeight: 700 }}>{(store as any).printifyShopTitle || `Shop #${store.printifyShopId}`}</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.5, marginTop: 4 }}>Đã kết nối</div>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} style={{ color: "var(--color-wise-green)" }} />
              <button onClick={handleUnlink} disabled={linking} className="btn btn-secondary" style={{ fontSize: "0.8rem" }}>
                {linking ? <Loader2 size={12} className="animate-spin" /> : null} Ngắt kết nối
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not linked — show picker
  return (
    <div>
      <h3 style={{ fontWeight: 700, marginBottom: 8 }}>Kết nối Printify Shop</h3>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 16 }}>
        Chọn một Printify shop để gắn vào store này. Shop phải được thêm từ trang{" "}
        <Link href="/printify" style={{ color: "var(--color-wise-green)", fontWeight: 600 }}>Printify Accounts</Link>.
      </p>

      {loading ? (
        <div className="flex items-center gap-2" style={{ padding: 20, opacity: 0.5 }}>
          <Loader2 size={14} className="animate-spin" /> Đang tải shops...
        </div>
      ) : shops.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <AlertTriangle size={24} style={{ color: "#f59e0b", margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 600 }}>Không có Printify shop nào</p>
          <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>
            Vào <Link href="/printify" style={{ color: "var(--color-wise-green)", fontWeight: 600 }}>Printify Accounts</Link> để thêm API key và đồng bộ shops.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {shops.map(shop => (
              <button
                key={shop.id}
                onClick={() => setSelectedShopId(shop.id)}
                className="card flex items-center gap-3"
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  border: selectedShopId === shop.id
                    ? "2px solid var(--color-wise-green)"
                    : "1px solid var(--border-default)",
                  background: selectedShopId === shop.id ? "rgba(159,232,112,0.08)" : "transparent",
                  textAlign: "left",
                  transition: "all 0.12s",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{shop.title}</div>
                  <div style={{ fontSize: "0.75rem", opacity: 0.5 }}>Account: {shop.account?.nickname || "—"}</div>
                </div>
                {selectedShopId === shop.id && <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />}
              </button>
            ))}
          </div>
          <button
            onClick={handleLink}
            disabled={!selectedShopId || linking}
            className="btn btn-primary"
          >
            {linking ? <Loader2 size={14} className="animate-spin" /> : null} Kết nối Shop
          </button>
        </>
      )}
    </div>
  );
}

/* ========== Templates Tab — Multi-template list & editor ========== */
function TemplatesSection({
  store,
  onRefreshStore,
}: {
  store: StoreDetail;
  onRefreshStore: (options?: { silent?: boolean }) => Promise<any>;
}) {
  type TemplateAction =
    | { type: "default"; templateId: string }
    | { type: "duplicate"; templateId: string }
    | { type: "delete"; templateId: string }
    | null;

  const [editingTemplate, setEditingTemplate] = useState<TemplateDetail | null>(null);
  const [originalTemplate, setOriginalTemplate] = useState<TemplateDetail | null>(null);
  const [tempTemplateData, setTempTemplateData] = useState<TemplateDetail | null>(null);
  const [editorStep, setEditorStep] = useState<"blueprint" | "variants" | "placement">("blueprint");
  
  const [searchQuery, setSearchQuery] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateAction, setTemplateAction] = useState<TemplateAction>(null);

  const updateTempData = useCallback((newData: Partial<TemplateDetail>) => {
    setTempTemplateData((prev) => (prev ? { ...prev, ...newData } : null));
  }, []);

  const isDirty = useMemo(() => {
    if (!tempTemplateData || !originalTemplate) return false;

    const keysToCompare: (keyof TemplateDetail)[] = [
      "name",
      "printifyBlueprintId",
      "printifyPrintProviderId",
      "blueprintTitle",
      "printProviderTitle",
      "position",
      "defaultAspectRatio",
      "blueprintImageUrl",
      "blueprintBrand",
      "defaultMockupSource",
    ];

    for (const k of keysToCompare) {
      if (tempTemplateData[k] !== originalTemplate[k]) return true;
    }

    if (JSON.stringify(tempTemplateData.enabledVariantIds) !== JSON.stringify(originalTemplate.enabledVariantIds)) return true;
    if (JSON.stringify(tempTemplateData.enabledSizes) !== JSON.stringify(originalTemplate.enabledSizes)) return true;
    if (JSON.stringify(tempTemplateData.defaultPlacement) !== JSON.stringify(originalTemplate.defaultPlacement)) return true;

    const tempColors = tempTemplateData.colors?.map((tc) => tc.color.name).sort().join(",") ?? "";
    const origColors = originalTemplate.colors?.map((tc) => tc.color.name).sort().join(",") ?? "";
    if (tempColors !== origColors) return true;

    return false;
  }, [tempTemplateData, originalTemplate]);

  async function handleDuplicate(templateId: string) {
    setTemplateAction({ type: "duplicate", templateId });
    try {
      const res = await fetch(`/api/stores/${store.id}/mockup-templates/${templateId}/duplicate`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Đã nhân bản template thành công!");
        await onRefreshStore({ silent: true });
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi nhân bản template");
      }
    } catch {
      toast.error("Lỗi nhân bản template");
    } finally {
      setTemplateAction(null);
    }
  }

  async function handleSetDefault(templateId: string) {
    setTemplateAction({ type: "default", templateId });
    try {
      const res = await fetch(`/api/stores/${store.id}/mockup-templates/${templateId}/default`, {
        method: "PUT",
      });
      if (res.ok) {
        toast.success("Đã đặt làm template mặc định!");
        await onRefreshStore({ silent: true });
      } else {
        const err = await res.json();
        const missing = Array.isArray(err.missing)
          ? formatTemplateMissingLabels(err.missing as TemplateMissing[])
          : "";
        toast.error(
          missing
            ? `Template chưa hoàn tất: ${missing}. Hoàn tất template trước khi đặt default.`
            : err.error || "Lỗi thiết lập mặc định",
        );
      }
    } catch {
      toast.error("Lỗi thiết lập mặc định");
    } finally {
      setTemplateAction(null);
    }
  }

  async function handleDelete(templateId: string) {
    if (!confirm("Bạn có chắc chắn muốn xoá template này? Thao tác này không thể hoàn tác.")) return;
    setTemplateAction({ type: "delete", templateId });
    try {
      const res = await fetch(`/api/stores/${store.id}/mockup-templates/${templateId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Đã xoá template thành công!");
        await onRefreshStore({ silent: true });
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi xoá template");
      }
    } catch {
      toast.error("Lỗi xoá template");
    } finally {
      setTemplateAction(null);
    }
  }

  async function handleSaveTemplate() {
    if (!tempTemplateData) return;
    if (!tempTemplateData.name.trim()) {
      toast.error("Vui lòng nhập tên template");
      return;
    }
    if (!tempTemplateData.printifyBlueprintId || !tempTemplateData.printifyPrintProviderId) {
      toast.error("Vui lòng chọn Blueprint và Provider");
      return;
    }

    setSavingTemplate(true);
    try {
      // 1. Register selected colors in the store color master list
      const templateColors = tempTemplateData.colors.map((tc) => tc.color);
      const existingNames = new Set(store.colors.map((c) => c.name.trim().toLowerCase()));
      const newColorsToRegister = templateColors.filter((tc) => !existingNames.has(tc.name.trim().toLowerCase()));
      
      let allStoreColors = [...store.colors];

      if (newColorsToRegister.length > 0) {
        const colorsRes = await fetch(`/api/stores/${store.id}/colors`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            colors: [
              ...store.colors.map((c) => ({
                name: c.name,
                hex: c.hex,
                printifyColorId: c.printifyColorId,
                enabled: c.enabled,
                sortOrder: c.sortOrder,
              })),
              ...newColorsToRegister.map((c, i) => ({
                name: c.name,
                hex: c.hex,
                printifyColorId: null,
                enabled: true,
                sortOrder: store.colors.length + i,
              })),
            ],
          }),
        });

        if (colorsRes.ok) {
          const data = await colorsRes.json();
          allStoreColors = data.colors;
        } else {
          const err = await colorsRes.json();
          throw new Error(err.error || "Không thể đăng ký màu sắc cho store");
        }
      }

      // Map color names to store color IDs (case-insensitive and trimmed)
      const colorIds = tempTemplateData.colors
        .map((tc) => {
          const found = allStoreColors.find(
            (c) => c.name.trim().toLowerCase() === tc.color.name.trim().toLowerCase()
          );
          return found?.id;
        })
        .filter((id): id is string => !!id);

      // 2. Save template details
      const isNew = tempTemplateData.id === "new";
      const url = isNew
        ? `/api/stores/${store.id}/mockup-templates`
        : `/api/stores/${store.id}/mockup-templates/${tempTemplateData.id}`;
      const method = isNew ? "POST" : "PATCH";

      const payload = {
        name: tempTemplateData.name,
        printifyBlueprintId: tempTemplateData.printifyBlueprintId,
        printifyPrintProviderId: tempTemplateData.printifyPrintProviderId,
        blueprintTitle: tempTemplateData.blueprintTitle,
        printProviderTitle: tempTemplateData.printProviderTitle,
        enabledVariantIds: tempTemplateData.enabledVariantIds,
        enabledSizes: tempTemplateData.enabledSizes,
        defaultPlacement: tempTemplateData.defaultPlacement,
        colorIds,
        blueprintImageUrl: tempTemplateData.blueprintImageUrl,
        blueprintBrand: tempTemplateData.blueprintBrand,
        position: tempTemplateData.position,
        defaultAspectRatio: tempTemplateData.defaultAspectRatio,
        storePresetSnapshot: tempTemplateData.storePresetSnapshot,
        defaultMockupSource: tempTemplateData.defaultMockupSource,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(isNew ? "Đã tạo template thành công!" : "Đã cập nhật template thành công!");
        setEditingTemplate(null);
        setTempTemplateData(null);
        setOriginalTemplate(null);
        await onRefreshStore({ silent: true });
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi lưu template");
      }
    } catch (e) {
      console.error(e);
      toast.error("Có lỗi xảy ra");
    } finally {
      setSavingTemplate(false);
    }
  }

  // Set local state when editing template starts
  const startEditing = useCallback((template: TemplateDetail) => {
    setEditingTemplate(template);
    setOriginalTemplate(template);
    setTempTemplateData(JSON.parse(JSON.stringify(template)));
    setEditorStep("blueprint");
  }, []);

  // Filter templates list
  const filteredTemplates = useMemo(() => {
    return store.templates.filter(
      (t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.blueprintTitle.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [store.templates, searchQuery]);

  if (!store.printifyShopId) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <AlertTriangle size={24} style={{ color: "#f59e0b", margin: "0 auto 12px" }} />
        <p style={{ fontWeight: 600 }}>Chưa kết nối Printify</p>
        <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>Vào tab Printify để kết nối shop trước.</p>
      </div>
    );
  }

  // 1. List / Table view
  if (!editingTemplate || !tempTemplateData) {
    return (
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div>
            <div className="flex items-center gap-2">
              <h3 style={{ fontWeight: 700, margin: 0 }}>🧰 Templates</h3>
              <span className="badge badge-success" style={{ fontSize: "0.72rem", minWidth: 22, textAlign: "center" }}>{store.templates.length}</span>
            </div>
            <p style={{ opacity: 0.5, fontSize: "0.85rem", marginTop: 4 }}>
              Mỗi template gồm blueprint, variants và placement riêng. Default template được dùng khi Wizard chạy.
            </p>
          </div>
          {store.templates.length > 0 && (
            <button
              onClick={() => {
                const newTpl: TemplateDetail = {
                  id: "new",
                  name: "",
                  printifyBlueprintId: 0,
                  printifyPrintProviderId: 0,
                  blueprintTitle: "",
                  printProviderTitle: "",
                  enabledVariantIds: [],
                  enabledSizes: [],
                  position: "FRONT",
                  defaultPlacement: null,
                  defaultAspectRatio: "1:1",
                  storePresetSnapshot: null,
                  isDefault: false,
                  sortOrder: store.templates.length,
                  defaultMockupSource: "PRINTIFY",
                  colors: [],
                };
                startEditing(newTpl);
              }}
              className="btn btn-primary flex items-center gap-1"
            >
              <Plus size={14} /> New template
            </button>
          )}
        </div>

        {store.templates.length === 0 ? (
          <div>
            <div
              className="card"
              style={{
                padding: "48px 32px",
                textAlign: "center",
                border: "2px dashed var(--border-default)",
                background: "transparent",
                borderRadius: 12,
                marginBottom: 24,
              }}
            >
              <Package size={48} style={{ color: "var(--color-wise-green)", opacity: 0.8, margin: "0 auto 16px" }} />
              <h4 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>Chưa có template nào</h4>
              <p style={{ opacity: 0.6, fontSize: "0.88rem", maxWidth: 500, margin: "0 auto 24px", lineHeight: 1.5 }}>
                Mỗi template gồm Blueprint + Variants + Placement. Bạn có thể tạo nhiều templates (ví dụ: Tee, Hoodie, Tank) để Wizard dùng lại nhanh.
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  onClick={() => {
                    const newTpl: TemplateDetail = {
                      id: "new",
                      name: "Default Template",
                      printifyBlueprintId: 0,
                      printifyPrintProviderId: 0,
                      blueprintTitle: "",
                      printProviderTitle: "",
                      enabledVariantIds: [],
                      enabledSizes: [],
                      position: "FRONT",
                      defaultPlacement: null,
                      defaultAspectRatio: "1:1",
                      storePresetSnapshot: null,
                      isDefault: true,
                      sortOrder: 0,
                      defaultMockupSource: "PRINTIFY",
                      colors: [],
                    };
                    startEditing(newTpl);
                  }}
                  className="btn btn-primary"
                >
                  + Tạo template đầu tiên
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 24 }}>
              <div className="card" style={{ padding: 16, textAlign: "left" }}>
                <div style={{ fontWeight: 700, color: "var(--color-wise-green)", fontSize: "1.1rem", marginBottom: 8 }}>1</div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>Pick blueprint</div>
                <div style={{ opacity: 0.5, fontSize: "0.75rem" }}>Chọn sản phẩm + provider từ Printify</div>
              </div>
              <div className="card" style={{ padding: 16, textAlign: "left" }}>
                <div style={{ fontWeight: 700, color: "var(--color-wise-green)", fontSize: "1.1rem", marginBottom: 8 }}>2</div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>Pick variants</div>
                <div style={{ opacity: 0.5, fontSize: "0.75rem" }}>Chọn màu sắc & kích thước để bán</div>
              </div>
              <div className="card" style={{ padding: 16, textAlign: "left" }}>
                <div style={{ fontWeight: 700, color: "var(--color-wise-green)", fontSize: "1.1rem", marginBottom: 8 }}>3</div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>Set placement</div>
                <div style={{ opacity: 0.5, fontSize: "0.75rem" }}>Căn chỉnh vị trí in ấn mặc định</div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }} />
                <input
                  className="input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm template..."
                  style={{ paddingLeft: 30, fontSize: "0.82rem" }}
                />
              </div>
            </div>

            {store.templates.length > 0 && !store.templates.some((t) => t.isDefault && getTemplateMissing(t).length === 0) && (
              <div
                className="alert"
                style={{
                  marginBottom: 12,
                  backgroundColor: "rgba(245, 158, 11, 0.06)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                }}
              >
                <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
                <span className="flex-1" style={{ fontSize: "0.84rem" }}>
                  Chưa có default template sẵn sàng. Hoàn tất một template rồi đặt làm default để Wizard có thể chạy.
                </span>
              </div>
            )}

            <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "var(--bg-inset)", borderBottom: "1px solid var(--border-default)" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600 }}>TEMPLATE</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600 }}>BLUEPRINT</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600 }}>COLORS</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600 }}>SIZES</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600 }}>PLACEMENTS</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>HÀNH ĐỘNG</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTemplates.map((t) => {
                    const enabledViews = getEnabledViews(normalizePlacementData(t.defaultPlacement, false));
                    const missing = getTemplateMissing(t);
                    const ready = missing.length === 0;
                    const statusLabel = t.isDefault
                      ? ready ? "DEFAULT" : "DEFAULT INCOMPLETE"
                      : ready ? "READY" : "INCOMPLETE";
                    const statusStyle = ready
                      ? { backgroundColor: "rgba(159,232,112,0.18)", color: "#166534" }
                      : { backgroundColor: "rgba(245, 158, 11, 0.12)", color: "#92400e" };
                    const rowAction = templateAction?.templateId === t.id ? templateAction.type : null;
                    const rowBusy = Boolean(rowAction);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => startEditing(t)}
                        style={{ borderBottom: "1px solid var(--border-default)", cursor: "pointer", transition: "background 0.1s" }}
                        className="hover-row"
                      >
                        <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                          <div className="flex items-center gap-3">
                            <div style={{
                              width: 32, height: 32, borderRadius: "50%",
                              background: "#d1fae5", color: "#065f46",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase",
                              flexShrink: 0,
                            }}>
                              {t.name?.[0] || "T"}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span>{t.name}</span>
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "0.62rem",
                                    ...statusStyle,
                                  }}
                                  title={ready ? statusLabel : `Thiếu: ${formatTemplateMissingLabels(missing)}`}
                                >
                                  {statusLabel}
                                </span>
                                {t.defaultMockupSource === "CUSTOM" ? (
                                  <span style={{ padding: "1px 8px", borderRadius: 9999, background: "rgba(159,232,112,0.18)", color: "#054d28", fontSize: 11, fontWeight: 700 }}>Custom</span>
                                ) : (
                                  <span style={{ padding: "1px 8px", borderRadius: 9999, background: "var(--bg-inset)", color: "var(--text-secondary)", fontSize: 11, fontWeight: 700 }}>Printify</span>
                                )}
                              </div>
                              <div style={{ fontSize: "0.72rem", opacity: 0.4, fontWeight: 400 }}>
                                {t.blueprintTitle ? `${t.printProviderTitle || "Provider"}` : "Chưa cấu hình"}
                              </div>
                              {t.defaultMockupSource === "CUSTOM" && (
                                <Link
                                  href={`/stores/${store.id}/mockup-library`}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ fontSize: "0.72rem", color: "var(--color-wise-green)", fontWeight: 500 }}
                                >
                                  Thư viện mockup →
                                </Link>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", opacity: 0.7 }}>
                          <div>{t.blueprintTitle || "—"}</div>
                          <div style={{ fontSize: "0.72rem", opacity: 0.5 }}>{t.printProviderTitle}</div>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 3, justifyContent: "center", alignItems: "center", flexWrap: "wrap", maxWidth: 140, margin: "0 auto" }}>
                            {t.colors.length > 0 ? (
                              <>
                                {t.colors.slice(0, 5).map((tc) => (
                                  <div
                                    key={tc.id}
                                    style={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: "50%",
                                      backgroundColor: tc.color.hex,
                                      border: "1.5px solid rgba(0,0,0,0.12)",
                                    }}
                                    title={tc.color.name}
                                  />
                                ))}
                                <span style={{ fontSize: "0.75rem", opacity: 0.6, marginLeft: 2, fontWeight: 500 }}>
                                  {t.colors.length}
                                </span>
                              </>
                            ) : (
                              <span style={{ fontSize: "0.8rem", opacity: 0.35 }}>0</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 3, justifyContent: "center", flexWrap: "wrap" }}>
                            {(t.enabledSizes?.length ?? 0) > 0 ? (
                              t.enabledSizes.map((size) => (
                                <span
                                  key={size}
                                  style={{
                                    display: "inline-block",
                                    padding: "1px 6px",
                                    fontSize: "0.68rem",
                                    fontWeight: 600,
                                    borderRadius: 4,
                                    background: "var(--bg-inset)",
                                    border: "1px solid var(--border-default)",
                                    lineHeight: 1.5,
                                  }}
                                >
                                  {size}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: "0.8rem", opacity: 0.35 }}>—</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {enabledViews.map((view) => (
                              <span
                                key={view}
                                className="badge badge-success"
                                style={{
                                  fontSize: "0.68rem",
                                  padding: "2px 6px",
                                  backgroundColor: "rgba(159,232,112,0.12)",
                                  color: "var(--color-wise-green)",
                                }}
                              >
                                {VIEW_LABELS[view] || view}
                              </span>
                            ))}
                            {enabledViews.length === 0 && (
                              <span style={{ opacity: 0.4, fontSize: "0.8rem" }}>Chưa cấu hình</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => startEditing(t)}
                              className="btn btn-secondary"
                              disabled={rowBusy}
                              style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                              title="Chỉnh sửa template"
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              onClick={() => handleDuplicate(t.id)}
                              className="btn btn-secondary"
                              disabled={rowBusy}
                              style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                              title="Nhân bản template"
                            >
                              {rowAction === "duplicate" ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                            </button>
                            {!t.isDefault && ready && (
                              <button
                                onClick={() => handleSetDefault(t.id)}
                                className="btn btn-secondary"
                                disabled={rowBusy}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "0.75rem",
                                }}
                                title="Đặt làm mặc định"
                              >
                                {rowAction === "default" ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
                              </button>
                            )}
                            {(!t.isDefault || !ready) && (
                              <button
                                onClick={() => handleDelete(t.id)}
                                className="btn btn-secondary"
                                disabled={rowBusy}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "0.75rem",
                                  color: "#ef4444",
                                }}
                                title="Xoá template"
                              >
                                {rowAction === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Info banner */}
            <div style={{
              marginTop: 16,
              padding: "12px 16px",
              borderRadius: 8,
              background: "rgba(159,232,112,0.08)",
              border: "1px solid rgba(159,232,112,0.2)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: "0.82rem",
              color: "var(--text-secondary)",
            }}>
              <span style={{ color: "var(--color-wise-green)", fontSize: "1rem" }}>ℹ️</span>
              <span>
                <strong>Default template</strong> sẽ được dùng tự động khi Wizard chạy. Bạn có thể đổi bằng <code>⋯</code> menu hoặc click vào một template.
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. Editor View
  const hasSelectedBlueprint = tempTemplateData.printifyBlueprintId && tempTemplateData.printifyPrintProviderId;

  return (
    <div>
      {/* Editor Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setEditingTemplate(null);
              setTempTemplateData(null);
            }}
            style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5, display: "flex", alignItems: "center", padding: 0 }}
          >
            <ArrowLeft size={18} />
          </button>
          <span style={{ opacity: 0.5, fontSize: "0.85rem", cursor: "pointer" }} onClick={() => setEditingTemplate(null)}>Templates</span>
          <span style={{ opacity: 0.3 }}>/</span>
          <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
            {tempTemplateData.name || "Template mới"}
          </span>
          {isDirty && (
            <span className="badge badge-warning" style={{ fontSize: "0.7rem", marginLeft: 8 }}>
              • Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditingTemplate(null);
              setTempTemplateData(null);
            }}
            className="btn btn-secondary"
            disabled={savingTemplate}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveTemplate}
            disabled={savingTemplate || !isDirty}
            className="btn btn-primary"
          >
            {savingTemplate ? <Loader2 size={14} className="animate-spin" /> : null} Save template
          </button>
        </div>
      </div>

      {/* Editor step layout */}
      <div style={{ display: "flex", gap: 16, borderBottom: "2px solid var(--border-default)", marginBottom: 24 }}>
        {(["blueprint", "variants", "placement"] as const).map((step) => {
          const isActive = editorStep === step;
          const disabled = step !== "blueprint" && !hasSelectedBlueprint;
          return (
            <button
              key={step}
              onClick={() => !disabled && setEditorStep(step)}
              disabled={disabled}
              style={{
                padding: "10px 16px",
                fontWeight: isActive ? 700 : 500,
                fontSize: "0.84rem",
                borderStyle: "solid",
                borderWidth: "0 0 2px 0",
                borderColor: isActive ? "var(--color-wise-green)" : "transparent",
                marginBottom: -2,
                backgroundColor: "transparent",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.3 : isActive ? 1 : 0.6,
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {step === "blueprint" && "1. Blueprint & Provider"}
              {step === "variants" && "2. Màu sắc & Kích thước"}
              {step === "placement" && "3. Vị trí in ấn"}
            </button>
          );
        })}
      </div>

      {/* Step Contents */}
      {editorStep === "blueprint" && (
        <EditorBlueprintStep
          store={store}
          value={tempTemplateData}
          onChange={updateTempData}
        />
      )}

      {editorStep === "variants" && (
        <EditorVariantsStep
          store={store}
          value={tempTemplateData}
          onChange={updateTempData}
        />
      )}

      {editorStep === "placement" && (
        <EditorPlacementStep
          store={store}
          value={tempTemplateData}
          onChange={updateTempData}
        />
      )}
    </div>
  );
}

/* ========== Editor Blueprint Step ========== */
function EditorBlueprintStep({
  store,
  value,
  onChange,
}: {
  store: StoreDetail;
  value: TemplateDetail;
  onChange: (data: Partial<TemplateDetail>) => void;
}) {
  const [blueprints, setBlueprints] = useState<Array<{ id: number; title: string; brand: string; images: string[] }>>([]);
  const [providers, setProviders] = useState<Array<{ id: number; title: string }>>([]);
  const [loadingBp, setLoadingBp] = useState(false);
  const [loadingPp, setLoadingPp] = useState(false);
  const [searchBp, setSearchBp] = useState("");
  const [searchPp, setSearchPp] = useState("");

  const [editingBp, setEditingBp] = useState(!value.printifyBlueprintId);
  const [editingPp, setEditingPp] = useState(!value.printifyPrintProviderId);

  useEffect(() => {
    if (!editingBp) return;
    setLoadingBp(true);
    fetch(`/api/stores/${store.id}/catalog?action=blueprints`)
      .then((r) => r.json())
      .then((d) => setBlueprints(d.blueprints || []))
      .catch(() => {})
      .finally(() => setLoadingBp(false));
  }, [store.id, editingBp]);

  useEffect(() => {
    if (!value.printifyBlueprintId || !editingPp) {
      setProviders([]);
      return;
    }
    setLoadingPp(true);
    fetch(`/api/stores/${store.id}/catalog?action=providers&blueprintId=${value.printifyBlueprintId}`)
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => {})
      .finally(() => setLoadingPp(false));
  }, [store.id, value.printifyBlueprintId, editingPp]);

  const filteredBp = blueprints.filter(
    (b) => !searchBp.trim() || b.title.toLowerCase().includes(searchBp.toLowerCase()),
  );

  return (
    <div>
      {/* Template Name Input */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h4 style={{ fontWeight: 700, margin: "0 0 16px 0" }}>Cài đặt chung</h4>
        <div style={{ maxWidth: 400 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>Tên Template</label>
          <input
            className="input"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Ví dụ: Unisex Tee, Premium Hoodie..."
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <h4 style={{ fontWeight: 700, marginBottom: 16 }}>Chọn sản phẩm từ Printify</h4>

      {/* Blueprint picker */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>Blueprint</label>
        {!editingBp && value.printifyBlueprintId ? (
          <div className="card flex items-center gap-3" style={{ padding: "10px 14px" }}>
            {value.blueprintImageUrl && (
              <img
                src={value.blueprintImageUrl}
                alt=""
                style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover" }}
              />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{value.blueprintTitle}</div>
              {value.blueprintBrand && <div style={{ fontSize: "0.75rem", opacity: 0.5 }}>{value.blueprintBrand}</div>}
            </div>
            <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />
            <button
              onClick={() => setEditingBp(true)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-wise-green)", fontWeight: 600, fontSize: "0.8rem" }}
            >
              Đổi
            </button>
          </div>
        ) : (
          <>
            <input
              className="input"
              value={searchBp}
              onChange={(e) => setSearchBp(e.target.value)}
              placeholder="Tìm blueprint..."
              style={{ display: "block", width: "100%", maxWidth: 400, marginBottom: 8 }}
            />
            {loadingBp ? (
              <div className="flex items-center gap-2" style={{ padding: 12, opacity: 0.5 }}>
                <Loader2 size={14} className="animate-spin" /> Đang tải blueprints...
              </div>
            ) : (
              <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border-default)", borderRadius: 8 }}>
                {filteredBp.slice(0, 50).map((bp) => (
                  <button
                    key={bp.id}
                    onClick={() => {
                      onChange({
                        printifyBlueprintId: bp.id,
                        blueprintTitle: bp.title,
                        blueprintBrand: bp.brand,
                        blueprintImageUrl: bp.images?.[0] || "",
                        printifyPrintProviderId: 0,
                        printProviderTitle: "",
                        enabledVariantIds: [],
                        enabledSizes: [],
                        colors: [],
                        defaultPlacement: null,
                      });
                      setEditingBp(false);
                      setEditingPp(true);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 12px",
                      borderStyle: "solid",
                      borderWidth: "0 0 1px 0",
                      borderColor: "var(--border-default)",
                      background: value.printifyBlueprintId === bp.id ? "rgba(159,220,68,0.1)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {bp.images?.[0] && (
                      <img src={bp.images[0]} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: "cover" }} />
                    )}
                    <div>
                      <div style={{ fontWeight: value.printifyBlueprintId === bp.id ? 700 : 500, fontSize: "0.85rem" }}>
                        {bp.title}
                      </div>
                      <div style={{ fontSize: "0.75rem", opacity: 0.5 }}>{bp.brand}</div>
                    </div>
                    {value.printifyBlueprintId === bp.id && (
                      <CheckCircle2 size={16} style={{ marginLeft: "auto", color: "var(--color-wise-green)" }} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Provider picker */}
      {value.printifyBlueprintId && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>Print Provider</label>
          {!editingPp && value.printifyPrintProviderId ? (
            <div className="card flex items-center gap-3" style={{ padding: "10px 14px" }}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: "0.9rem" }}>{value.printProviderTitle}</div>
              <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />
              <button
                onClick={() => setEditingPp(true)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-wise-green)", fontWeight: 600, fontSize: "0.8rem" }}
              >
                Đổi
              </button>
            </div>
          ) : (
            <>
              {loadingPp ? (
                <div className="flex items-center gap-2" style={{ padding: 12, opacity: 0.5 }}>
                  <Loader2 size={14} className="animate-spin" /> Đang tải providers...
                </div>
              ) : providers.length === 0 ? (
                <div style={{ padding: 12, opacity: 0.5, fontSize: "0.85rem" }}>Không có provider nào</div>
              ) : (
                <>
                  <input
                    className="input"
                    value={searchPp}
                    onChange={(e) => setSearchPp(e.target.value)}
                    placeholder="Tìm provider..."
                    style={{ display: "block", width: "100%", maxWidth: 400, marginBottom: 8 }}
                  />
                  <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border-default)", borderRadius: 8 }}>
                    {providers
                      .filter((pp) => !searchPp.trim() || pp.title.toLowerCase().includes(searchPp.toLowerCase()))
                      .map((pp) => (
                        <button
                          key={pp.id}
                          onClick={() => {
                            onChange({
                              printifyPrintProviderId: pp.id,
                              printProviderTitle: pp.title,
                            });
                            setEditingPp(false);
                            // Auto trigger template name if empty
                            if (!value.name) {
                              onChange({ name: `${value.blueprintTitle} - ${pp.title}` });
                            }
                          }}
                          style={{
                            padding: "10px 14px",
                            width: "100%",
                            cursor: "pointer",
                            borderStyle: "solid",
                            borderWidth: "0 0 1px 0",
                            borderColor: "var(--border-default)",
                            background: value.printifyPrintProviderId === pp.id ? "rgba(159,220,68,0.1)" : "transparent",
                            textAlign: "left",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontWeight: value.printifyPrintProviderId === pp.id ? 700 : 500, fontSize: "0.85rem", flex: 1 }}>
                            {pp.title}
                          </div>
                          {value.printifyPrintProviderId === pp.id && (
                            <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)" }} />
                          )}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Nguồn mockup mặc định */}
      <MockupSourceSection store={store} value={value} onChange={onChange} />
    </div>
  );
}

/* ========== MockupSourceSection ========== */
function MockupSourceSection({
  store,
  value,
  onChange,
}: {
  store: StoreDetail;
  value: TemplateDetail;
  onChange: (data: Partial<TemplateDetail>) => void;
}) {
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [loadingMissing, setLoadingMissing] = useState(false);

  const selected = value.defaultMockupSource ?? "PRINTIFY";

  useEffect(() => {
    if (selected !== "CUSTOM" || value.id === "new") {
      setMissingCount(null);
      return;
    }
    setLoadingMissing(true);
    fetch(`/api/stores/${store.id}/mockup-library`)
      .then((r) => r.json())
      .then((d) => {
        const templates: Array<{ id: string; colors: Array<{ colorId: string; sources: unknown[] }> }> = d.templates ?? [];
        const tpl = templates.find((t) => t.id === value.id);
        if (!tpl) {
          setMissingCount(0);
          return;
        }
        const missing = tpl.colors.filter((c) => (c.sources as unknown[]).length === 0).length;
        setMissingCount(missing);
      })
      .catch(() => setMissingCount(null))
      .finally(() => setLoadingMissing(false));
  }, [selected, value.id, store.id]);

  const options: Array<{ key: "PRINTIFY" | "CUSTOM"; icon: React.ReactNode; title: string; desc: string }> = [
    {
      key: "PRINTIFY",
      icon: <Truck size={20} />,
      title: "Printify",
      desc: "Tự tạo mockup từ Printify theo blueprint, màu và vị trí in của template.",
    },
    {
      key: "CUSTOM",
      icon: <Image size={20} />,
      title: "Custom",
      desc: "Dùng mockup tái sử dụng đã upload trong Thư viện mockup cho template này.",
    },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <h4 style={{ fontWeight: 700, marginBottom: 12 }}>Nguồn mockup mặc định</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {options.map((opt) => {
          const isActive = selected === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange({ defaultMockupSource: opt.key })}
              style={{
                padding: 16,
                borderRadius: 10,
                border: isActive ? "1.5px solid #9fe870" : "1px solid var(--border-default)",
                boxShadow: isActive ? "0 0 0 4px rgba(159,232,112,0.16)" : "none",
                background: isActive ? "rgba(159,232,112,0.06)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.12s",
              }}
            >
              <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: isActive ? "5px solid #9fe870" : "2px solid var(--border-default)",
                    flexShrink: 0,
                    transition: "border 0.12s",
                  }}
                />
                <span style={{ opacity: 0.6 }}>{opt.icon}</span>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{opt.title}</span>
              </div>
              <p style={{ fontSize: "0.8rem", opacity: 0.6, margin: 0, lineHeight: 1.4 }}>{opt.desc}</p>
            </button>
          );
        })}
      </div>

      {selected === "CUSTOM" && (
        <div style={{ marginTop: 12 }}>
          {loadingMissing ? (
            <div className="flex items-center gap-2" style={{ fontSize: "0.82rem", opacity: 0.5 }}>
              <Loader2 size={13} className="animate-spin" /> Đang kiểm tra mockup...
            </div>
          ) : missingCount === null ? null : missingCount > 0 ? (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                background: "rgba(255,209,26,0.10)",
                border: "1px solid rgba(255,209,26,0.3)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <AlertTriangle size={16} style={{ color: "#d97706", flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, fontSize: "0.82rem" }}>
                <span>
                  Template đang dùng Custom nhưng còn <strong>{missingCount} màu</strong> chưa có mockup tái sử dụng.
                </span>
                <div style={{ marginTop: 8 }}>
                  <Link
                    href={`/stores/${store.id}/mockup-library`}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 6,
                      background: "rgba(255,209,26,0.25)",
                      color: "#92400e",
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Mở Thư viện mockup →
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                background: "rgba(56,200,255,0.08)",
                border: "1px solid rgba(56,200,255,0.2)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <CheckCircle2 size={16} style={{ color: "#0ea5e9", flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, fontSize: "0.82rem" }}>
                <span>Template sẽ dùng mockup tái sử dụng trong Thư viện mockup.</span>
                <div style={{ marginTop: 8 }}>
                  <Link
                    href={`/stores/${store.id}/mockup-library`}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 6,
                      background: "rgba(56,200,255,0.15)",
                      color: "#0369a1",
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Lưu template rồi mở Thư viện mockup →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========== Editor Variants Step ========== */
function EditorVariantsStep({
  store,
  value,
  onChange,
}: {
  store: StoreDetail;
  value: TemplateDetail;
  onChange: (data: Partial<TemplateDetail>) => void;
}) {
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [colorSearch, setColorSearch] = useState("");

  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loadingSizes, setLoadingSizes] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const selectedColors = useMemo(() => {
    return new Set(value.colors.map((c) => c.color.name));
  }, [value.colors]);

  const enabledSizes = useMemo(() => {
    return new Set(value.enabledSizes || []);
  }, [value.enabledSizes]);

  // 1. Fetch variant groups (colors data)
  useEffect(() => {
    setLoadingVariants(true);
    fetch(`/api/stores/${store.id}/catalog?action=variants&blueprintId=${value.printifyBlueprintId}&printProviderId=${value.printifyPrintProviderId}`)
      .then((r) => r.json())
      .then((d) => setVariantGroups(d.variantGroups || []))
      .catch(() => toast.error("Không tải được biến thể"))
      .finally(() => setLoadingVariants(false));
  }, [store.id, value.printifyBlueprintId, value.printifyPrintProviderId]);

  // 2. Fetch sizes (cost cache lazy loaded)
  const fetchSizes = useCallback(async () => {
    setLoadingSizes(true);
    setWarning(null);
    try {
      const res = await fetch(`/api/stores/${store.id}/sizes?blueprintId=${value.printifyBlueprintId}&printProviderId=${value.printifyPrintProviderId}`);
      const data = await res.json();
      setSizes(data.sizes ?? []);
      if (data.warning) setWarning(data.warning);
    } catch {
      toast.error("Không tải được kích thước");
    } finally {
      setLoadingSizes(false);
    }
  }, [store.id, value.printifyBlueprintId, value.printifyPrintProviderId]);

  useEffect(() => {
    fetchSizes();
  }, [fetchSizes]);

  // Propagate changes when colors or sizes toggled
  const propagateChanges = useCallback((nextColorsSet: Set<string>, nextSizesSet: Set<string>) => {
    // 1. Calculate color records list for state
    const nextColors = Array.from(nextColorsSet).map((colorName) => {
      const gp = variantGroups.find((g) => g.color === colorName);
      return {
        id: "",
        templateId: value.id,
        colorId: "",
        color: {
          id: "",
          name: colorName,
          hex: gp?.colorHex || "#EEEEEE",
        },
      };
    });

    // 2. Calculate enabledVariantIds matching selected colors AND sizes
    const nextVariantIds = variantGroups
      .filter((g) => nextColorsSet.has(g.color))
      .flatMap((g) =>
        g.variants
          .filter((v) => {
            const sizeOpt = Object.entries(v.options).find(([k]) => k.toLowerCase() === "size")?.[1] || "ONE_SIZE";
            return nextSizesSet.has(String(sizeOpt));
          })
          .map((v) => v.id),
      );

    onChange({
      colors: nextColors,
      enabledSizes: Array.from(nextSizesSet),
      enabledVariantIds: nextVariantIds,
    });
  }, [value.id, variantGroups, onChange]);

  function toggleColor(color: string) {
    const nextColors = new Set(selectedColors);
    if (nextColors.has(color)) {
      nextColors.delete(color);
    } else {
      nextColors.add(color);
    }
    propagateChanges(nextColors, enabledSizes);
  }

  function toggleSize(size: string) {
    const nextSizes = new Set(enabledSizes);
    if (nextSizes.has(size)) {
      nextSizes.delete(size);
    } else {
      nextSizes.add(size);
    }
    propagateChanges(selectedColors, nextSizes);
  }

  async function handleRefreshPrices() {
    setRefreshingPrices(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/variant-cache/refresh?blueprintId=${value.printifyBlueprintId}&printProviderId=${value.printifyPrintProviderId}`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Đã cập nhật bảng giá từ Printify!");
        await fetchSizes();
      } else {
        const e = await res.json();
        toast.error(e.error || "Lỗi cập nhật bảng giá");
      }
    } catch {
      toast.error("Lỗi cập nhật bảng giá");
    } finally {
      setRefreshingPrices(false);
    }
  }

  return (
    <div>
      {/* Colors section */}
      <div style={{ marginBottom: 28 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <Palette size={18} style={{ opacity: 0.5 }} />
          <h3 style={{ fontWeight: 700, margin: 0 }}>Màu sắc từ Printify</h3>
          {selectedColors.size > 0 && (
            <span
              className="badge badge-success"
              style={{ fontSize: "0.72rem", padding: "2px 8px", background: "rgba(159,232,112,0.15)", color: "var(--color-wise-green)" }}
            >
              {selectedColors.size} đã chọn
            </span>
          )}
        </div>
        <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 16 }}>Chọn các màu bạn muốn bán.</p>

        {loadingVariants ? (
          <div className="flex items-center gap-2" style={{ padding: 20, opacity: 0.5 }}>
            <Loader2 size={14} className="animate-spin" /> Đang tải biến thể...
          </div>
        ) : variantGroups.length === 0 ? (
          <div style={{ padding: 16, opacity: 0.4, fontSize: "0.85rem", textAlign: "center" }}>Không tìm thấy màu sắc</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <input
                className="input"
                value={colorSearch}
                onChange={(e) => setColorSearch(e.target.value)}
                placeholder="Tìm màu..."
                style={{ maxWidth: 240, fontSize: "0.82rem" }}
              />
              <button
                type="button"
                onClick={() => propagateChanges(new Set(variantGroups.map((g) => g.color)), enabledSizes)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}
              >
                Chọn tất cả
              </button>
              {selectedColors.size > 0 && (
                <>
                  <span style={{ opacity: 0.2 }}>·</span>
                  <button
                    type="button"
                    onClick={() => propagateChanges(new Set(), enabledSizes)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500 }}
                  >
                    Bỏ chọn
                  </button>
                </>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {variantGroups
                .filter((g) => !colorSearch.trim() || g.color.toLowerCase().includes(colorSearch.toLowerCase()))
                .map((g) => {
                  const on = selectedColors.has(g.color);
                  return (
                    <button
                      key={g.color}
                      type="button"
                      onClick={() => toggleColor(g.color)}
                      className="flex items-center gap-2"
                      style={{
                        padding: "6px 12px",
                        borderRadius: 10,
                        border: on ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                        backgroundColor: on ? "rgba(159,232,112,0.08)" : "transparent",
                        cursor: "pointer",
                        fontSize: "0.82rem",
                        fontWeight: on ? 600 : 400,
                        transition: "all 0.12s",
                      }}
                    >
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          backgroundColor: g.colorHex,
                          border: "1px solid rgba(0,0,0,0.1)",
                          flexShrink: 0,
                        }}
                      />
                      <span>{g.color}</span>
                      <span style={{ opacity: 0.4, fontSize: "0.7rem" }}>({g.sizes.length} sizes)</span>
                      {on && <CheckCircle2 size={13} style={{ color: "var(--color-wise-green)" }} />}
                    </button>
                  );
                })}
            </div>
          </>
        )}
      </div>

      {/* Sizes Section */}
      <div>
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <Ruler size={18} style={{ opacity: 0.5 }} />
          <h3 style={{ fontWeight: 700, margin: 0 }}>Kích thước</h3>
          {enabledSizes.size > 0 && (
            <span
              className="badge badge-success"
              style={{ fontSize: "0.72rem", padding: "2px 8px", background: "rgba(159,232,112,0.15)", color: "var(--color-wise-green)" }}
            >
              {enabledSizes.size} đã chọn
            </span>
          )}
          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={handleRefreshPrices}
              disabled={refreshingPrices}
              className="flex items-center gap-1"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}
            >
              <RefreshCw size={12} className={refreshingPrices ? "animate-spin" : ""} /> Refresh giá
            </button>
          </div>
        </div>
        <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 12 }}>Chọn kích thước muốn bán.</p>

        {warning && (
          <div
            className="flex items-center gap-2"
            style={{
              padding: "8px 14px",
              marginBottom: 12,
              borderRadius: 8,
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.2)",
              fontSize: "0.82rem",
            }}
          >
            <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0 }} />
            <span>{warning}</span>
          </div>
        )}

        {loadingSizes ? (
          <div className="flex items-center gap-2" style={{ padding: 20, opacity: 0.5 }}>
            <Loader2 size={14} className="animate-spin" /> Đang tải kích thước...
          </div>
        ) : sizes.length === 0 ? (
          <div style={{ padding: 16, opacity: 0.4, fontSize: "0.85rem", textAlign: "center" }}>Không có kích thước</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() =>
                  propagateChanges(selectedColors, new Set(sizes.filter((s) => s.isAvailable).map((s) => s.size)))
                }
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}
              >
                Chọn tất cả khả dụng
              </button>
              {enabledSizes.size > 0 && (
                <>
                  <span style={{ opacity: 0.2 }}>·</span>
                  <button
                    type="button"
                    onClick={() => propagateChanges(selectedColors, new Set())}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500 }}
                  >
                    Bỏ chọn
                  </button>
                </>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {sizes.map((s) => {
                const on = enabledSizes.has(s.size);
                const disabled = !s.isAvailable;
                return (
                  <button
                    key={s.size}
                    type="button"
                    onClick={() => !disabled && toggleSize(s.size)}
                    className="flex items-center gap-2"
                    title={disabled ? "Hết hàng tại nhà in này" : `${s.availableColors} màu có sẵn`}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 10,
                      border: on ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                      backgroundColor: disabled ? "rgba(148,163,184,0.08)" : on ? "rgba(159,232,112,0.08)" : "transparent",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.4 : 1,
                      fontSize: "0.82rem",
                      fontWeight: on ? 600 : 400,
                      transition: "all 0.12s",
                      textDecoration: disabled ? "line-through" : "none",
                    }}
                  >
                    <span>{s.size}</span>
                    {s.costDeltaCents > 0 && (
                      <span style={{ fontSize: "0.7rem", color: "#f59e0b", fontWeight: 600 }}>
                        +${(s.costDeltaCents / 100).toFixed(2)}
                      </span>
                    )}
                    {on && !disabled && <CheckCircle2 size={13} style={{ color: "var(--color-wise-green)" }} />}
                    {disabled && (
                      <span style={{ fontSize: "0.65rem", color: "#ef4444", fontWeight: 600 }}>Hết hàng</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ========== Editor Placement Step ========== */
function EditorPlacementStep({
  store,
  value,
  onChange,
}: {
  store: StoreDetail;
  value: TemplateDetail;
  onChange: (data: Partial<TemplateDetail>) => void;
}) {
  const [placementData, setPlacementData] = useState<PlacementData>(() =>
    normalizePlacementData(value.defaultPlacement, true),
  );

  useEffect(() => {
    onChange({ defaultPlacement: normalizePlacementData(placementData, false) });
  }, [placementData, onChange]);

  const bgColor = value.colors?.[0]?.color?.hex || "#EEEEEE";

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div>
          <h3 style={{ fontWeight: 700, margin: 0 }}>Vị trí in ấn mặc định</h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", marginTop: 4 }}>
            Bật các vị trí in bạn muốn hiển thị trên mockups. Wizard tạo listing sẽ kế thừa preset này.
          </p>
        </div>
      </div>
      <MultiViewPlacementEditor
        value={placementData}
        onChange={setPlacementData}
        bgColor={bgColor}
        title="Placement mặc định của store"
        description="Bật các vị trí in store sẽ dùng khi tạo listing. Wizard sẽ kế thừa preset này."
      />
    </div>
  );
}
