"use client";

import React, { useEffect, useState, useMemo, useCallback, Suspense, useRef } from "react";
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
  Upload,
  X,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { MultiViewPlacementEditor } from "@/components/placement/MultiViewPlacementEditor";
import type { PlacementData, ViewKey } from "@/lib/placement/types";
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
  // Per-color sizes: { colorName → string[] }. Null = use enabledSizes as global fallback.
  enabledSizesByColor: Record<string, string[]> | null;
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
  }, [fetchStore, justConnected]);

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
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/integrations/printify/shops?available=true", { signal: controller.signal })
      .then(async r => {
        if (!r.ok) throw new Error("Lỗi tải danh sách shop");
        const d = await r.json();
        setShops(Array.isArray(d) ? d : d.shops || []);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to load shops:", err);
          toast.error("Lỗi tải danh sách shop");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
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
              <div style={{ fontWeight: 700 }}>{store.printifyShopTitle || `Shop #${store.printifyShopId}`}</div>
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

function createEmptyTemplate(sortOrder: number, isDefault = false, name = ""): TemplateDetail {
  return {
    id: "new",
    name,
    printifyBlueprintId: 0,
    printifyPrintProviderId: 0,
    blueprintTitle: "",
    printProviderTitle: "",
    enabledVariantIds: [],
    enabledSizes: [],
      enabledSizesByColor: null,
    position: "FRONT",
    defaultPlacement: null,
    defaultAspectRatio: "1:1",
    storePresetSnapshot: null,
    isDefault,
    sortOrder,
    defaultMockupSource: "PRINTIFY",
    colors: [],
  };
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
  type EditorStep = "blueprint" | "variants" | "placement" | "mockups";
  const [editorStep, setEditorStep] = useState<EditorStep>("blueprint");
  
  const [pendingMockups, setPendingMockups] = useState<Map<string, { file: File; previewUrl: string }>>(new Map());

  const showMockupStep = useMemo(() => {
    if (!tempTemplateData) return false;
    return (
      tempTemplateData.defaultMockupSource === "CUSTOM" &&
      tempTemplateData.colors.length > 0
    );
  }, [tempTemplateData]);

  // Clear pending mockups when switching to PRINTIFY
  const currentMockupSource = tempTemplateData?.defaultMockupSource;
  useEffect(() => {
    if (currentMockupSource === "PRINTIFY") {
      setPendingMockups((prev) => {
        if (prev.size === 0) return prev;
        prev.forEach((entry) => {
          URL.revokeObjectURL(entry.previewUrl);
        });
        return new Map();
      });
    }
  }, [currentMockupSource]);

  // Clean up object URLs on unmount
  const pendingMockupsRef = useRef(pendingMockups);
  useEffect(() => {
    pendingMockupsRef.current = pendingMockups;
  }, [pendingMockups]);

  useEffect(() => {
    return () => {
      pendingMockupsRef.current.forEach((entry) => {
        URL.revokeObjectURL(entry.previewUrl);
      });
    };
  }, []);

  // Redirect away from mockups step if it is no longer valid
  useEffect(() => {
    if (editorStep === "mockups" && !showMockupStep) {
      setEditorStep("blueprint");
    }
  }, [showMockupStep, editorStep]);

  const [searchQuery, setSearchQuery] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateAction, setTemplateAction] = useState<TemplateAction>(null);

  const updateTempData = useCallback((newData: Partial<TemplateDetail>) => {
    setTempTemplateData((prev) => (prev ? { ...prev, ...newData } : null));
  }, []);

  const handleCloseEditor = useCallback(() => {
    // Cleanup preview URLs
    pendingMockups.forEach((entry) => {
      URL.revokeObjectURL(entry.previewUrl);
    });
    setPendingMockups(new Map());
    setEditingTemplate(null);
    setTempTemplateData(null);
    setOriginalTemplate(null);
    setEditorStep("blueprint");
  }, [pendingMockups]);

  // Build mockup URLs by view for placement preview
  // Uses first available mockup (from pending or existing) and applies to ALL views
  const mockupUrlsByView = useMemo<Record<string, string | null>>(() => {
    if (!tempTemplateData || tempTemplateData.defaultMockupSource !== "CUSTOM") return {};
    const firstColorName = tempTemplateData.colors?.[0]?.color?.name?.toLowerCase();
    if (!firstColorName) return {};

    const placementData = normalizePlacementData(tempTemplateData.defaultPlacement, false);
    const views = getEnabledViews(placementData);

    // Find best mockup URL: try first color pending, then iterate all colors
    let bestUrl: string | null = null;
    const pendingFirst = pendingMockups.get(firstColorName);
    if (pendingFirst) {
      bestUrl = pendingFirst.previewUrl;
    } else {
      for (const c of tempTemplateData.colors) {
        const p = pendingMockups.get(c.color.name.toLowerCase());
        if (p) { bestUrl = p.previewUrl; break; }
      }
    }

    // Apply same URL to all views
    const result: Record<string, string | null> = {};
    for (const view of views) {
      result[view] = bestUrl;
    }
    return result;
  }, [tempTemplateData, pendingMockups]);

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
    if (JSON.stringify(tempTemplateData.enabledSizesByColor) !== JSON.stringify(originalTemplate.enabledSizesByColor)) return true;
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
        enabledSizesByColor: tempTemplateData.enabledSizesByColor ?? undefined,
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
        let savedTemplate = null;
        try {
          savedTemplate = await res.json();
        } catch (e) {
          console.error("Failed to parse saved template JSON:", e);
        }
        const savedTemplateId = savedTemplate?.id || tempTemplateData.id;

        if (pendingMockups.size > 0 && savedTemplateId) {
          const colorNameToId = new Map<string, string>(
            allStoreColors.map((c) => [c.name.trim().toLowerCase(), c.id])
          );

          let successCount = 0;
          let failCount = 0;

          for (const [colorName, { file }] of pendingMockups) {
            const colorId = colorNameToId.get(colorName.trim().toLowerCase());
            if (!colorId) {
              failCount++;
              continue;
            }
            const form = new FormData();
            form.set("file", file);
            form.set("templateId", savedTemplateId);
            form.set("colorId", colorId);
            form.set("view", "front");
            form.set("sceneType", "flat_lay");
            form.set("renderMode", "FINAL");
            form.set("isPrimary", "true");

            try {
              const uploadRes = await fetch(`/api/stores/${store.id}/mockup-library`, {
                method: "POST",
                body: form,
              });
              if (uploadRes.ok) {
                successCount++;
              } else {
                failCount++;
              }
            } catch (err) {
              console.error(err);
              failCount++;
            }
          }

          if (successCount > 0) {
            toast.success(`Đã upload thành công ${successCount} mockup!`);
          }
          if (failCount > 0) {
            toast.error(`Không thể upload ${failCount} mockup. Vui lòng vào Thư viện mockup để upload lại.`);
          }
        }

        toast.success(isNew ? "Đã tạo template thành công!" : "Đã cập nhật template thành công!");
        handleCloseEditor();
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
                const newTpl = createEmptyTemplate(store.templates.length, false, "");
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
                    const newTpl = createEmptyTemplate(0, true, "Default Template");
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
            onClick={handleCloseEditor}
            style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5, display: "flex", alignItems: "center", padding: 0 }}
          >
            <ArrowLeft size={18} />
          </button>
          <span style={{ opacity: 0.5, fontSize: "0.85rem", cursor: "pointer" }} onClick={handleCloseEditor}>Templates</span>
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
            onClick={handleCloseEditor}
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
      <div style={{ display: "flex", gap: 16, borderBottom: "2px solid var(--border-default)", marginBottom: 24, overflowX: "auto" }}>
        {(
          showMockupStep
            ? (["blueprint", "variants", "mockups", "placement"] as const)
            : (["blueprint", "variants", "placement"] as const)
        ).map((step) => {
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
              {step === "mockups" && "3. Tải lên Mockup"}
              {step === "placement" && (showMockupStep ? "4. Vị trí in ấn" : "3. Vị trí in ấn")}
            </button>
          );
        })}
      </div>

      {/* Redirect away from mockups step if it is no longer valid is handled by top-level useEffect */}

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

      {editorStep === "mockups" && showMockupStep && (
        <EditorMockupsStep
          colors={tempTemplateData.colors}
          pendingMockups={pendingMockups}
          onChangePendingMockups={setPendingMockups}
          existingTemplateId={tempTemplateData.id === "new" ? null : tempTemplateData.id}
          storeId={store.id}
        />
      )}

      {editorStep === "placement" && (
        <EditorPlacementStep
          store={store}
          value={tempTemplateData}
          onChange={updateTempData}
          mockupUrlsByView={mockupUrlsByView}
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
    const controller = new AbortController();
    setLoadingBp(true);
    fetch(`/api/stores/${store.id}/catalog?action=blueprints`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setBlueprints(d.blueprints || []))
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to fetch blueprints:", err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingBp(false);
        }
      });
    return () => controller.abort();
  }, [store.id, editingBp]);

  useEffect(() => {
    if (!value.printifyBlueprintId || !editingPp) {
      setProviders([]);
      return;
    }
    const controller = new AbortController();
    setLoadingPp(true);
    fetch(`/api/stores/${store.id}/catalog?action=providers&blueprintId=${value.printifyBlueprintId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to fetch providers:", err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingPp(false);
        }
      });
    return () => controller.abort();
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
                        enabledSizesByColor: null,
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
                      <img src={bp.images[0]} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: "cover" }} loading="lazy" />
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
  const selected = value.defaultMockupSource ?? "PRINTIFY";

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
      desc: "Dùng mockup custom đã upload cho template này.",
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
        <div
          style={{
            marginTop: 12,
            padding: "12px 16px",
            borderRadius: 8,
            background: "rgba(159,232,112,0.06)",
            border: "1px solid rgba(159,232,112,0.2)",
            fontSize: "0.82rem",
            opacity: 0.7,
          }}
        >
          Mockup sẽ được upload ở bước <strong>"Tải lên Mockup"</strong> khi chỉnh sửa template.
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
    const controller = new AbortController();
    setLoadingVariants(true);
    fetch(`/api/stores/${store.id}/catalog?action=variants&blueprintId=${value.printifyBlueprintId}&printProviderId=${value.printifyPrintProviderId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setVariantGroups(d.variantGroups || []))
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to load variants:", err);
          toast.error("Không tải được biến thể");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingVariants(false);
        }
      });
    return () => controller.abort();
  }, [store.id, value.printifyBlueprintId, value.printifyPrintProviderId]);

  // 2. Fetch sizes (cost cache lazy loaded)
  const fetchSizes = useCallback(async (signal?: AbortSignal) => {
    setLoadingSizes(true);
    setWarning(null);
    try {
      const res = await fetch(`/api/stores/${store.id}/sizes?blueprintId=${value.printifyBlueprintId}&printProviderId=${value.printifyPrintProviderId}`, { signal });
      const data = await res.json();
      setSizes(data.sizes ?? []);
      if (data.warning) setWarning(data.warning);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Failed to fetch sizes:", err);
        toast.error("Không tải được kích thước");
      }
    } finally {
      setLoadingSizes(false);
    }
  }, [store.id, value.printifyBlueprintId, value.printifyPrintProviderId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSizes(controller.signal);
    return () => controller.abort();
  }, [fetchSizes]);

  // Per-color sizes map: { colorName → Set<string> }
  // Auto-fills from enabledSizes[] (global) when enabledSizesByColor is null (legacy templates)
  const enabledSizesByColorMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const colorName of selectedColors) {
      const colorSizes = value.enabledSizesByColor?.[colorName]
        ?? value.enabledSizes; // fallback: apply global sizes to all colors
      map.set(colorName, new Set(colorSizes ?? []));
    }
    return map;
  }, [selectedColors, value.enabledSizesByColor, value.enabledSizes]);

  // Propagate changes when colors or per-color sizes toggled
  const propagateChanges = useCallback((nextColorsSet: Set<string>, nextSizesByColor: Map<string, Set<string>>) => {
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

    // 2. Calculate enabledVariantIds — per-color size intersection
    const nextVariantIds = variantGroups
      .filter((g) => nextColorsSet.has(g.color))
      .flatMap((g) =>
        g.variants
          .filter((v) => {
            const sizeOpt = Object.entries(v.options).find(([k]) => k.toLowerCase() === "size")?.[1] || "ONE_SIZE";
            const sizesForThisColor = nextSizesByColor.get(g.color);
            return sizesForThisColor?.has(String(sizeOpt)) ?? false;
          })
          .map((v) => v.id),
      );

    // 3. Build enabledSizesByColor object
    const sizesByColorObj: Record<string, string[]> = {};
    for (const [colorName, sizesSet] of nextSizesByColor) {
      sizesByColorObj[colorName] = Array.from(sizesSet);
    }
    // Union of all sizes (kept in enabledSizes for publish fallback)
    const allSizes = Array.from(new Set(Array.from(nextSizesByColor.values()).flatMap((s) => Array.from(s))));

    onChange({
      colors: nextColors,
      enabledSizes: allSizes,
      enabledSizesByColor: nextColorsSet.size > 0 ? sizesByColorObj : null,
      enabledVariantIds: nextVariantIds,
    });
  }, [value.id, variantGroups, onChange]);

  function toggleColor(color: string) {
    const nextColors = new Set(selectedColors);
    if (nextColors.has(color)) {
      nextColors.delete(color);
      // Remove color from size map too
      const nextMap = new Map(enabledSizesByColorMap);
      nextMap.delete(color);
      propagateChanges(nextColors, nextMap);
    } else {
      nextColors.add(color);
      // Auto-fill: use the color's available sizes from variantGroups or global enabledSizes
      const nextMap = new Map(enabledSizesByColorMap);
      const colorGroup = variantGroups.find((g) => g.color === color);
      const colorSizes = colorGroup ? new Set(colorGroup.sizes) : new Set(value.enabledSizes ?? []);
      nextMap.set(color, colorSizes);
      propagateChanges(nextColors, nextMap);
    }
  }

  function toggleSizeForColor(colorName: string, size: string) {
    const nextMap = new Map(enabledSizesByColorMap);
    const current = new Set(nextMap.get(colorName) ?? []);
    if (current.has(size)) {
      current.delete(size);
    } else {
      current.add(size);
    }
    nextMap.set(colorName, current);
    propagateChanges(selectedColors, nextMap);
  }

  function selectAllSizesForColor(colorName: string) {
    const colorGroup = variantGroups.find((g) => g.color === colorName);
    const nextMap = new Map(enabledSizesByColorMap);
    nextMap.set(colorName, new Set(colorGroup?.sizes ?? sizes.filter((s) => s.isAvailable).map((s) => s.size)));
    propagateChanges(selectedColors, nextMap);
  }

  function clearSizesForColor(colorName: string) {
    const nextMap = new Map(enabledSizesByColorMap);
    nextMap.set(colorName, new Set());
    propagateChanges(selectedColors, nextMap);
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
                onClick={() => {
                  const allColorsSet = new Set(variantGroups.map((g) => g.color));
                  const newMap = new Map<string, Set<string>>();
                  for (const colorName of allColorsSet) {
                    const colorGroup = variantGroups.find((g) => g.color === colorName);
                    newMap.set(colorName, new Set(colorGroup?.sizes ?? []));
                  }
                  propagateChanges(allColorsSet, newMap);
                }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}
              >
                Chọn tất cả
              </button>
              {selectedColors.size > 0 && (
                <>
                  <span style={{ opacity: 0.2 }}>·</span>
                  <button
                    type="button"
                    onClick={() => propagateChanges(new Set(), new Map())}
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

      {/* Sizes Section — per-color grid */}
      <div>
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <Ruler size={18} style={{ opacity: 0.5 }} />
          <h3 style={{ fontWeight: 700, margin: 0 }}>Kích thước theo màu</h3>
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
        <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 16 }}>
          Mỗi màu có bộ size riêng. Size không khả dụng cho màu đó sẽ bị mờ.
        </p>

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

        {selectedColors.size === 0 ? (
          <div style={{ padding: 16, opacity: 0.4, fontSize: "0.85rem", textAlign: "center" }}>Chọn ít nhất 1 màu để cấu hình kích thước</div>
        ) : loadingVariants || loadingSizes ? (
          <div className="flex items-center gap-2" style={{ padding: 20, opacity: 0.5 }}>
            <Loader2 size={14} className="animate-spin" /> Đang tải...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Array.from(selectedColors).map((colorName) => {
              // Sizes available for this specific color from catalog
              const colorGroup = variantGroups.find((g) => g.color === colorName);
              const colorAvailableSizes = colorGroup ? new Set(colorGroup.sizes) : null;
              const enabledForColor = enabledSizesByColorMap.get(colorName) ?? new Set<string>();
              const totalEnabled = enabledForColor.size;

              return (
                <div
                  key={colorName}
                  style={{
                    border: "1px solid var(--border-default)",
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  {/* Color header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      background: "rgba(255,255,255,0.03)",
                      borderBottom: "1px solid var(--border-default)",
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        backgroundColor: colorGroup?.colorHex ?? "#ccc",
                        border: "1px solid rgba(0,0,0,0.12)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 700, fontSize: "0.88rem", flex: 1 }}>{colorName}</span>
                    {totalEnabled > 0 && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "2px 8px",
                          borderRadius: 20,
                          background: "rgba(159,232,112,0.15)",
                          color: "var(--color-wise-green)",
                          fontWeight: 600,
                        }}
                      >
                        {totalEnabled} size
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => selectAllSizesForColor(colorName)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.72rem", color: "var(--color-wise-green)", fontWeight: 500 }}
                    >
                      Tất cả
                    </button>
                    <span style={{ opacity: 0.2 }}>·</span>
                    <button
                      type="button"
                      onClick={() => clearSizesForColor(colorName)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.72rem", color: "#94a3b8", fontWeight: 500 }}
                    >
                      Bỏ hết
                    </button>
                  </div>

                  {/* Sizes grid for this color */}
                  <div style={{ padding: "12px 14px", display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {sizes.map((s) => {
                      // A size is unavailable for this color if the color group doesn't include it
                      const unavailableForColor = colorAvailableSizes != null && !colorAvailableSizes.has(s.size);
                      const globalUnavailable = !s.isAvailable;
                      const isDisabled = globalUnavailable || unavailableForColor;
                      const on = enabledForColor.has(s.size);

                      return (
                        <button
                          key={s.size}
                          type="button"
                          onClick={() => !isDisabled && toggleSizeForColor(colorName, s.size)}
                          title={
                            unavailableForColor
                              ? `${colorName} không có size ${s.size}`
                              : globalUnavailable
                                ? "Hết hàng tại nhà in này"
                                : `${s.availableColors} màu có sẵn`
                          }
                          style={{
                            padding: "7px 14px",
                            borderRadius: 10,
                            border: on ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                            backgroundColor: isDisabled
                              ? "rgba(148,163,184,0.06)"
                              : on
                                ? "rgba(159,232,112,0.08)"
                                : "transparent",
                            cursor: isDisabled ? "not-allowed" : "pointer",
                            opacity: isDisabled ? 0.35 : 1,
                            fontSize: "0.82rem",
                            fontWeight: on ? 600 : 400,
                            transition: "all 0.12s",
                            textDecoration: globalUnavailable ? "line-through" : "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span>{s.size}</span>
                          {s.costDeltaCents > 0 && (
                            <span style={{ fontSize: "0.68rem", color: "#f59e0b", fontWeight: 600 }}>
                              +${(s.costDeltaCents / 100).toFixed(2)}
                            </span>
                          )}
                          {on && !isDisabled && <CheckCircle2 size={12} style={{ color: "var(--color-wise-green)" }} />}
                          {unavailableForColor && (
                            <span style={{ fontSize: "0.62rem", color: "#94a3b8" }}>N/A</span>
                          )}
                          {globalUnavailable && !unavailableForColor && (
                            <span style={{ fontSize: "0.62rem", color: "#ef4444", fontWeight: 600 }}>Hết</span>
                          )}
                        </button>
                      );
                    })}
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

/* ========== Editor Placement Step ========== */
function EditorPlacementStep({
  store,
  value,
  onChange,
  mockupUrlsByView,
}: {
  store: StoreDetail;
  value: TemplateDetail;
  onChange: (data: Partial<TemplateDetail>) => void;
  mockupUrlsByView?: Record<string, string | null>;
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
        mockupUrlsByView={mockupUrlsByView}
        title="Placement mặc định của store"
        description="Bật các vị trí in store sẽ dùng khi tạo listing. Wizard sẽ kế thừa preset này."
      />
    </div>
  );
}

function EditorMockupsStep({
  colors,
  pendingMockups,
  onChangePendingMockups,
  existingTemplateId,
  storeId,
}: {
  colors: TemplateDetail["colors"];
  pendingMockups: Map<string, { file: File; previewUrl: string }>;
  onChangePendingMockups: React.Dispatch<React.SetStateAction<Map<string, { file: File; previewUrl: string }>>>;
  existingTemplateId: string | null;
  storeId: string;
}) {
  // Key format: colorName (lowercase)
  const [existingMockups, setExistingMockups] = useState<Map<string, string>>(new Map());
  const [loadingExisting, setLoadingExisting] = useState(false);

  useEffect(() => {
    if (!existingTemplateId) return;
    const controller = new AbortController();
    setLoadingExisting(true);
    fetch(`/api/stores/${storeId}/mockup-library`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        const temp = d.templates?.find((t: any) => t.id === existingTemplateId);
        if (temp) {
          const mockupMap = new Map<string, string>();
          for (const c of temp.colors || []) {
            const colorKey = (c.name as string).toLowerCase();
            for (const source of c.sources || []) {
              // Use first primary or first available source per color
              if (!mockupMap.has(colorKey) || (source as any).isPrimary) {
                mockupMap.set(colorKey, (source as any).imageUrl || (source as any).outputUrl);
              }
            }
          }
          setExistingMockups(mockupMap);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Error loading existing mockups:", err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingExisting(false);
        }
      });
    return () => controller.abort();
  }, [existingTemplateId, storeId]);

  const handleFileChange = (colorKey: string, file: File | null) => {
    if (!file) {
      onChangePendingMockups((prev) => {
        const next = new Map(prev);
        const entry = next.get(colorKey);
        if (entry) {
          URL.revokeObjectURL(entry.previewUrl);
          next.delete(colorKey);
        }
        return next;
      });
      return;
    }

    const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!ALLOWED_TYPES.has(file.type)) {
      toast.error("Chỉ hỗ trợ ảnh dạng JPEG, PNG, và WebP");
      return;
    }
    const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("File phải nhỏ hơn hoặc bằng 10MB");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    onChangePendingMockups((prev) => {
      const next = new Map(prev);
      const entry = next.get(colorKey);
      if (entry) {
        URL.revokeObjectURL(entry.previewUrl);
      }
      next.set(colorKey, { file, previewUrl });
      return next;
    });
  };

  const totalColors = colors.length;
  const readyCount = colors.filter((c) => {
    const key = c.color.name.toLowerCase();
    return pendingMockups.has(key) || existingMockups.has(key);
  }).length;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h3 style={{ fontWeight: 700, margin: 0 }}>Tải lên Mockup</h3>
        <p style={{ opacity: 0.5, fontSize: "0.85rem", marginTop: 4 }}>
          Tải lên ảnh mockup cho từng màu sắc. Mockup sẽ hiển thị làm nền ở bước Vị trí in ấn.
        </p>
      </div>

      {loadingExisting ? (
        <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 16,
          }}
        >
          {colors.map((c) => {
            const colorKey = c.color.name.toLowerCase();
            const pending = pendingMockups.get(colorKey);
            const existing = existingMockups.get(colorKey);
            const previewUrl = pending?.previewUrl || existing || null;

            return (
              <div
                key={c.color.name}
                className="card"
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  textAlign: "center",
                  border: pending
                    ? "2px dashed var(--color-wise-green)"
                    : "1px solid var(--border-default)",
                }}
              >
                <div className="flex items-center gap-2" style={{ width: "100%", justifyContent: "center" }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      backgroundColor: c.color.hex,
                      border: "1px solid rgba(0,0,0,0.15)",
                    }}
                  />
                  <strong style={{ fontSize: "0.88rem" }}>{c.color.name}</strong>
                </div>

                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 8,
                    backgroundColor: "var(--bg-secondary, #F9F9F9)",
                    border: "1px dashed var(--border-default)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt={c.color.name}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: 0.4 }}>
                      <Image size={24} />
                      <span style={{ fontSize: "0.72rem" }}>Chưa có ảnh</span>
                    </div>
                  )}
                </div>

                <div style={{ width: "100%", display: "grid", gap: 6 }}>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer", width: "100%", justifyContent: "center" }}>
                    <Upload size={12} />
                    {previewUrl ? "Thay đổi" : "Tải ảnh"}
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        handleFileChange(colorKey, file);
                      }}
                      style={{ display: "none" }}
                    />
                  </label>

                  {pending && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleFileChange(colorKey, null)}
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        color: "var(--text-danger, #ef4444)",
                        backgroundColor: "rgba(239, 68, 68, 0.05)",
                        border: "1px solid rgba(239, 68, 68, 0.15)",
                      }}
                    >
                      <X size={12} />
                      Hủy chọn
                    </button>
                  )}

                  {!pending && existing && (
                    <span style={{ fontSize: "0.72rem", color: "var(--color-wise-green)", fontWeight: 600 }}>
                      ✓ Đã upload
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between" style={{ borderTop: "1px solid var(--border-default)", paddingTop: 16 }}>
        <span style={{ fontSize: "0.84rem", fontWeight: 600 }}>
          Trạng thái: {readyCount} / {totalColors} màu đã có mockup
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.7, fontSize: "0.8rem" }}>
          <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)" }} />
          <span>Mockup sẽ được lưu cùng template.</span>
        </div>
      </div>
    </div>
  );
}

