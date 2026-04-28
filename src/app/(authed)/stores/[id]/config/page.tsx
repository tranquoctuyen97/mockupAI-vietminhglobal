"use client";

import { useEffect, useState, useMemo, useCallback, Suspense } from "react";
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
} from "lucide-react";
import Link from "next/link";
import { MultiViewPlacementEditor } from "@/components/placement/MultiViewPlacementEditor";
import type { PlacementData } from "@/lib/placement/types";
import {
  formatPlacementViewCount,
  formatPlacementViewDetails,
  normalizePlacementData,
} from "@/lib/placement/views";

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
  template: {
    id: string;
    name: string;
    printifyBlueprintId: number;
    printifyPrintProviderId: number;
    blueprintTitle: string;
    printProviderTitle: string;
    enabledVariantIds: number[];
    position: string;
    defaultPlacement: unknown;
    defaultPromptVersion: string;
    defaultAspectRatio: string;
    storePresetSnapshot: unknown;
  } | null;
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

type Tab = "printify" | "blueprint" | "colors" | "placement" | "overview";

/* ========== Tab status helpers ========== */
function getTabStatus(store: StoreDetail, tab: Tab): "done" | "warn" | "none" {
  switch (tab) {
    case "printify": return store.printifyShopId ? "done" : "warn";
    case "blueprint": return (store.template?.printifyBlueprintId && store.template?.printifyPrintProviderId) ? "done" : "warn";
    case "colors": return store.colors.filter(c => c.enabled !== false).length > 0 ? "done" : "warn";
    case "placement": return store.template?.defaultPlacement ? "done" : "warn";
    case "overview": return "none";
  }
}

function getFirstIncompleteTab(store: StoreDetail): Tab {
  if (!store.printifyShopId) return "printify";
  if (!store.template?.printifyBlueprintId) return "blueprint";
  if (!store.colors.length) return "colors";
  if (!store.template?.defaultPlacement) return "placement";
  return "overview";
}

const TABS: { key: Tab; label: string; icon: typeof Link2 }[] = [
  { key: "printify", label: "Printify", icon: Link2 },
  { key: "blueprint", label: "Blueprint", icon: Package },
  { key: "colors", label: "Variants", icon: Palette },
  { key: "placement", label: "Placement", icon: Move },
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

  const fetchStore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stores");
      if (res.ok) {
        const stores = await res.json();
        const found = stores.find((s: StoreDetail) => s.id === storeId);
        setStore(found || null);
        return found;
      }
    } finally {
      setLoading(false);
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
    fetchStore().then(() => setActiveTab(tab));
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
      {activeTab === "printify" && <PrintifySection store={store} onSave={() => refreshAndGoTo("blueprint")} />}
      {activeTab === "blueprint" && <BlueprintSection store={store} onSave={() => refreshAndGoTo("colors")} />}
      {activeTab === "colors" && (
        <>
          <ColorsSection store={store} onSave={() => refreshAndGoTo("placement")} />
          <SizesSubSection store={store} onRefreshStore={fetchStore} />
        </>
      )}
      {activeTab === "placement" && <PlacementSection store={store} onSave={() => refreshAndGoTo("overview")} />}
      {activeTab === "overview" && <OverviewTab store={store} onRefresh={fetchStore} />}
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
function OverviewTab({ store, onRefresh }: { store: StoreDetail; onRefresh: () => void }) {
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

      <button onClick={handleTest} disabled={testing} className="btn btn-secondary">
        {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Kiểm tra kết nối
      </button>
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

/* ========== Colors Tab — Printify-driven checkbox grid ========== */
function ColorsSection({ store, onSave }: { store: StoreDetail; onSave: () => void }) {
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialSelected = useMemo(
    () => new Set(store.colors.filter(c => c.enabled !== false).map(c => c.name)),
    [store.colors],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [colorSearch, setColorSearch] = useState("");
  const hasTemplate = !!store.template;

  useEffect(() => {
    if (!hasTemplate || !store.template?.printifyBlueprintId || !store.template?.printifyPrintProviderId) return;
    setLoading(true);
    const t = store.template;
    fetch(`/api/stores/${store.id}/catalog?action=variants&blueprintId=${t.printifyBlueprintId}&printProviderId=${t.printifyPrintProviderId}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Lỗi tải variants");
        setVariantGroups(d.variantGroups || []);
      })
      .catch(e => toast.error(e.message)).finally(() => setLoading(false));
  }, [store.id, hasTemplate]);

  function toggle(color: string) {
    setSelected(prev => { const n = new Set(prev); n.has(color) ? n.delete(color) : n.add(color); return n; });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const sel = variantGroups.filter(g => selected.has(g.color));
      await fetch(`/api/stores/${store.id}/colors`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colors: sel.map((g, i) => ({ name: g.color, hex: g.colorHex, printifyColorId: g.printifyColorId, sortOrder: i })) }) });
      const allIds = sel.flatMap(g => g.variants.map(v => v.id));
      await fetch(`/api/stores/${store.id}/template`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledVariantIds: allIds }) });
      toast.success("Đã lưu màu sắc!"); onSave();
    } catch { toast.error("Lỗi lưu"); } finally { setSaving(false); }
  }

  if (!hasTemplate || !store.template?.printifyBlueprintId || !store.template?.printifyPrintProviderId) return (
    <div className="card" style={{ padding: 40, textAlign: "center" }}>
      <AlertTriangle size={24} style={{ color: "#f59e0b", margin: "0 auto 12px" }} />
      <p style={{ fontWeight: 600 }}>Chưa có Blueprint</p>
      <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>Bạn cần chọn Blueprint & Print Provider trước.</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <Palette size={18} style={{ opacity: 0.5 }} />
        <h3 style={{ fontWeight: 700, margin: 0 }}>Màu sắc từ Printify</h3>
        {selected.size > 0 && <span style={{ fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: "rgba(159,232,112,0.15)", color: "var(--color-wise-green)" }}>{selected.size} đã chọn</span>}
      </div>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 16 }}>Chọn màu bạn muốn bán. Dữ liệu từ Printify.</p>
      {loading ? (
        <div className="flex items-center gap-2" style={{ padding: 20, opacity: 0.5 }}><Loader2 size={14} className="animate-spin" /> Đang tải variants...</div>
      ) : variantGroups.length === 0 ? (
        <div style={{ padding: 16, opacity: 0.4, fontSize: "0.85rem", textAlign: "center" }}>Không có variants</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              className="input"
              value={colorSearch}
              onChange={e => setColorSearch(e.target.value)}
              placeholder="Tìm màu..."
              style={{ maxWidth: 240, fontSize: "0.82rem" }}
            />
            <button type="button" onClick={() => setSelected(new Set(variantGroups.map(g => g.color)))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}>Chọn tất cả</button>
            {selected.size > 0 && <><span style={{ opacity: 0.2 }}>·</span><button type="button" onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500 }}>Bỏ chọn</button></>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {variantGroups
              .filter(g => !colorSearch.trim() || g.color.toLowerCase().includes(colorSearch.toLowerCase()))
              .map(g => { const on = selected.has(g.color); return (
              <button key={g.color} type="button" onClick={() => toggle(g.color)} className="flex items-center gap-2" title={`Kích thước: ${g.sizes.join(", ")}`} style={{ padding: "8px 14px", borderRadius: 10, border: on ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)", backgroundColor: on ? "rgba(159,232,112,0.08)" : "transparent", cursor: "pointer", fontSize: "0.82rem", fontWeight: on ? 600 : 400, transition: "all 0.12s" }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: g.colorHex, border: "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
                <span>{g.color}</span>
                <span style={{ opacity: 0.4, fontSize: "0.7rem" }}>({g.sizes.length} sizes)</span>
                {on && <CheckCircle2 size={13} style={{ color: "var(--color-wise-green)" }} />}
              </button>
            ); })}
          </div>
          <button onClick={handleSave} disabled={saving || selected.size === 0} className="btn btn-primary" style={{ marginTop: 20 }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu màu sắc ({selected.size})
          </button>
        </>
      )}
    </div>
  );
}

/* ========== Sizes Sub-Section (inside Variants tab) ========== */
function SizesSubSection({ store, onRefreshStore }: { store: StoreDetail; onRefreshStore: () => void }) {
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [enabledSizes, setEnabledSizes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const fetchSizes = useCallback(async () => {
    if (!store.template?.printifyBlueprintId) return;
    setLoading(true);
    setWarning(null);
    try {
      const res = await fetch(`/api/stores/${store.id}/sizes`);
      const data = await res.json();
      setSizes(data.sizes ?? []);
      setEnabledSizes(new Set(data.enabledSizes?.length > 0 ? data.enabledSizes : data.sizes?.map((s: SizeOption) => s.size) ?? []));
      if (data.warning) setWarning(data.warning);
    } catch {
      toast.error("Lỗi tải danh sách sizes");
    } finally {
      setLoading(false);
    }
  }, [store.id, store.template?.printifyBlueprintId]);

  useEffect(() => { fetchSizes(); }, [fetchSizes]);

  function toggleSize(size: string) {
    setEnabledSizes(prev => {
      const next = new Set(prev);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  }

  async function handleSave() {
    if (enabledSizes.size === 0) {
      toast.error("Chọn ít nhất 1 size");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/template`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledSizes: Array.from(enabledSizes) }),
      });
      if (res.ok) {
        toast.success("Đã lưu sizes!");
        onRefreshStore();
      } else {
        const e = await res.json();
        toast.error(e.error || "Lỗi lưu");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshPrices() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/variant-cache/refresh`, { method: "POST" });
      if (res.ok) {
        toast.success("Đã cập nhật giá từ Printify!");
        await fetchSizes();
      } else {
        const e = await res.json();
        toast.error(e.error || "Lỗi refresh");
      }
    } finally {
      setRefreshing(false);
    }
  }

  if (!store.template?.printifyBlueprintId) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <Ruler size={18} style={{ opacity: 0.5 }} />
        <h3 style={{ fontWeight: 700, margin: 0 }}>Kích thước</h3>
        {enabledSizes.size > 0 && (
          <span style={{ fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: "rgba(159,232,112,0.15)", color: "var(--color-wise-green)" }}>
            {enabledSizes.size} đã chọn
          </span>
        )}
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={handleRefreshPrices}
            disabled={refreshing}
            className="flex items-center gap-1"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh giá
          </button>
        </div>
      </div>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: 12 }}>
        Tick các size store này bán. Seller có thể bỏ tick thêm khi tạo listing.
      </p>

      {warning && (
        <div className="flex items-center gap-2" style={{ padding: "8px 14px", marginBottom: 12, borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", fontSize: "0.82rem" }}>
          <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0 }} />
          <span>{warning}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2" style={{ padding: 20, opacity: 0.5 }}>
          <Loader2 size={14} className="animate-spin" /> Đang tải sizes...
        </div>
      ) : sizes.length === 0 ? (
        <div style={{ padding: 16, opacity: 0.4, fontSize: "0.85rem", textAlign: "center" }}>Không có sizes</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => setEnabledSizes(new Set(sizes.filter(s => s.isAvailable).map(s => s.size)))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500 }}>
              Chọn tất cả
            </button>
            {enabledSizes.size > 0 && (
              <>
                <span style={{ opacity: 0.2 }}>·</span>
                <button type="button" onClick={() => setEnabledSizes(new Set())} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500 }}>
                  Bỏ chọn
                </button>
              </>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sizes.map(s => {
              const on = enabledSizes.has(s.size);
              const disabled = !s.isAvailable;
              return (
                <button
                  key={s.size}
                  type="button"
                  onClick={() => !disabled && toggleSize(s.size)}
                  className="flex items-center gap-2"
                  title={disabled ? "Hết hàng tại provider này" : `${s.availableColors} màu available`}
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

          <button
            onClick={handleSave}
            disabled={saving || enabledSizes.size === 0}
            className="btn btn-primary"
            style={{ marginTop: 16 }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {" "}Lưu sizes ({enabledSizes.size})
          </button>
        </>
      )}
    </div>
  );
}

/* ========== Blueprint Tab (Phase 6.10: select blueprint + provider) ========== */
function BlueprintSection({ store, onSave }: { store: StoreDetail; onSave: () => void }) {
  const savedBpId = store.template?.printifyBlueprintId ?? null;
  const savedPpId = store.template?.printifyPrintProviderId ?? null;
  const savedBpTitle = store.template?.blueprintTitle || "";
  const savedPpTitle = store.template?.printProviderTitle || "";

  const [blueprints, setBlueprints] = useState<Array<{ id: number; title: string; brand: string; images: string[] }>>([]);
  const [providers, setProviders] = useState<Array<{ id: number; title: string }>>([]);
  const [selectedBp, setSelectedBp] = useState<number | null>(savedBpId);
  const [selectedPp, setSelectedPp] = useState<number | null>(savedPpId);
  const [loadingBp, setLoadingBp] = useState(false);
  const [loadingPp, setLoadingPp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchBp, setSearchBp] = useState("");
  const [searchPp, setSearchPp] = useState("");

  // Collapse pickers khi đã có giá trị saved. Click "Đổi" để mở lại.
  const [editingBp, setEditingBp] = useState(!savedBpId);
  const [editingPp, setEditingPp] = useState(!savedPpId);

  // Sync lại khi store refetch
  useEffect(() => {
    setSelectedBp(savedBpId);
    setSelectedPp(savedPpId);
    setEditingBp(!savedBpId);
    setEditingPp(!savedPpId);
  }, [savedBpId, savedPpId]);

  useEffect(() => {
    if (!store.printifyShopId) return;
    // Chỉ fetch blueprints khi đang edit (hoặc chưa có saved)
    if (!editingBp) return;
    setLoadingBp(true);
    fetch(`/api/stores/${store.id}/catalog?action=blueprints`)
      .then(r => r.json())
      .then(d => setBlueprints(d.blueprints || []))
      .finally(() => setLoadingBp(false));
  }, [store.id, store.printifyShopId, editingBp]);

  useEffect(() => {
    if (!selectedBp || !store.printifyShopId) { setProviders([]); return; }
    if (!editingPp) return;
    setLoadingPp(true);
    fetch(`/api/stores/${store.id}/catalog?action=providers&blueprintId=${selectedBp}`)
      .then(r => r.json())
      .then(d => setProviders(d.providers || []))
      .finally(() => setLoadingPp(false));
  }, [store.id, selectedBp, store.printifyShopId, editingPp]);

  async function handleSave() {
    if (!selectedBp || !selectedPp) return;
    setSaving(true);

    // Find the selected blueprint and provider to get their titles
    const bpTitle = blueprints.find(b => b.id === selectedBp)?.title || savedBpTitle;
    const ppTitle = providers.find(p => p.id === selectedPp)?.title || savedPpTitle;
    const name = bpTitle || "Default Blueprint";

    try {
      const res = await fetch(`/api/stores/${store.id}/mockup-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          printifyBlueprintId: selectedBp,
          printifyPrintProviderId: selectedPp,
          blueprintTitle: bpTitle,
          printProviderTitle: ppTitle,
        }),
      });
      if (res.ok) {
        toast.success("Đã lưu Blueprint!");
        setEditingBp(false);
        setEditingPp(false);
        onSave();
      } else { const e = await res.json(); toast.error(e.error || "Lỗi"); }
    } finally { setSaving(false); }
  }

  if (!store.printifyShopId) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <AlertTriangle size={24} style={{ color: "#f59e0b", margin: "0 auto 12px" }} />
        <p style={{ fontWeight: 600 }}>Chưa kết nối Printify</p>
        <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>Vào tab Printify để gắn shop trước.</p>
      </div>
    );
  }

  const filteredBp = blueprints.filter(b =>
    !searchBp.trim() || b.title.toLowerCase().includes(searchBp.toLowerCase())
  );
  const selectedBpMeta = blueprints.find(b => b.id === selectedBp);
  const selectedPpMeta = providers.find(p => p.id === selectedPp);

  // Hiển thị title/brand từ DB khi chưa fetch list
  const displayBpTitle = selectedBpMeta?.title || savedBpTitle || (selectedBp ? `#${selectedBp}` : "");
  const displayBpBrand = selectedBpMeta?.brand || "";
  const displayBpImage = selectedBpMeta?.images?.[0];
  const displayPpTitle = selectedPpMeta?.title || savedPpTitle || (selectedPp ? `#${selectedPp}` : "");

  const hasChanges = selectedBp !== savedBpId || selectedPp !== savedPpId;

  return (
    <div>
      <h3 style={{ fontWeight: 700, marginBottom: 16 }}><Package size={18} style={{ display: "inline", marginRight: 8 }} />Blueprint & Provider</h3>

      {/* Blueprint picker — collapse sau khi chọn */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>Blueprint</label>
        {!editingBp && selectedBp ? (
          // Compact selected view
          <div className="card flex items-center gap-3" style={{ padding: "10px 14px" }}>
            {displayBpImage && <img src={displayBpImage} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover" }} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{displayBpTitle}</div>
              {displayBpBrand && <div style={{ fontSize: "0.75rem", opacity: 0.5 }}>{displayBpBrand}</div>}
            </div>
            <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />
            <button onClick={() => setEditingBp(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-wise-green)", fontWeight: 600, fontSize: "0.8rem" }}>
              Đổi
            </button>
          </div>
        ) : (
          // Full picker
          <>
            {savedBpId && (
              <button onClick={() => { setSelectedBp(savedBpId); setEditingBp(false); }} style={{ display: "block", background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500, marginBottom: 8, padding: 0 }}>
                ← Huỷ, giữ blueprint cũ
              </button>
            )}
            <input className="input" value={searchBp} onChange={e => setSearchBp(e.target.value)} placeholder="Tìm blueprint..." style={{ display: "block", width: "100%", maxWidth: 400, marginBottom: 8 }} />
            {loadingBp ? (
              <div className="flex items-center gap-2" style={{ padding: 12, opacity: 0.5 }}>
                <Loader2 size={14} className="animate-spin" /> Đang tải blueprints...
              </div>
            ) : (
              <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border-default)", borderRadius: 8 }}>
                {filteredBp.slice(0, 50).map(bp => (
                  <button key={bp.id} onClick={() => { setSelectedBp(bp.id); setSelectedPp(null); setEditingBp(false); setEditingPp(true); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border-default)", background: selectedBp === bp.id ? "rgba(159,220,68,0.1)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                    {bp.images?.[0] && <img src={bp.images[0]} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: "cover" }} />}
                    <div><div style={{ fontWeight: selectedBp === bp.id ? 700 : 500, fontSize: "0.85rem" }}>{bp.title}</div><div style={{ fontSize: "0.75rem", opacity: 0.5 }}>{bp.brand}</div></div>
                    {selectedBp === bp.id && <CheckCircle2 size={16} style={{ marginLeft: "auto", color: "var(--color-wise-green)" }} />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Provider picker — collapse sau khi chọn */}
      {selectedBp && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>Print Provider</label>
          {!editingPp && selectedPp ? (
            <div className="card flex items-center gap-3" style={{ padding: "10px 14px" }}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: "0.9rem" }}>{displayPpTitle}</div>
              <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />
              <button onClick={() => setEditingPp(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-wise-green)", fontWeight: 600, fontSize: "0.8rem" }}>
                Đổi
              </button>
            </div>
          ) : (
            <>
              {savedPpId && (
                <button onClick={() => { setSelectedPp(savedPpId); setEditingPp(false); }} style={{ display: "block", background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500, marginBottom: 8, padding: 0 }}>
                  ← Huỷ, giữ provider cũ
                </button>
              )}
              {loadingPp ? (
                <div className="flex items-center gap-2" style={{ padding: 12, opacity: 0.5 }}>
                  <Loader2 size={14} className="animate-spin" /> Đang tải providers...
                </div>
              ) : providers.length === 0 ? (
                <div style={{ padding: 12, opacity: 0.5, fontSize: "0.85rem" }}>Không có provider</div>
              ) : (
                <>
                  <input className="input" value={searchPp} onChange={e => setSearchPp(e.target.value)} placeholder="Tìm provider..." style={{ display: "block", width: "100%", maxWidth: 400, marginBottom: 8 }} />
                  <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--border-default)", borderRadius: 8, display: "grid", gap: 0 }}>
                    {providers
                      .filter(pp => !searchPp.trim() || pp.title.toLowerCase().includes(searchPp.toLowerCase()))
                      .map(pp => (
                        <button key={pp.id} onClick={() => { setSelectedPp(pp.id); setEditingPp(false); }} style={{ padding: "10px 14px", cursor: "pointer", border: "none", borderBottom: "1px solid var(--border-default)", background: selectedPp === pp.id ? "rgba(159,220,68,0.1)" : "transparent", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontWeight: selectedPp === pp.id ? 700 : 500, fontSize: "0.85rem", flex: 1 }}>{pp.title}</div>
                          {selectedPp === pp.id && <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)" }} />}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Save — chỉ hiện khi có thay đổi */}
      {hasChanges && selectedBp && selectedPp && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Lưu Blueprint
          </button>
          <button onClick={() => { setSelectedBp(savedBpId); setSelectedPp(savedPpId); setEditingBp(false); setEditingPp(false); }} disabled={saving} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", opacity: 0.7 }}>
            Huỷ thay đổi
          </button>
        </div>
      )}
    </div>
  );
}

function PlacementSection({ store, onSave }: { store: StoreDetail; onSave: () => void }) {
  const [saving, setSaving] = useState(false);
  const [initialPlacement] = useState<PlacementData>(() =>
    normalizePlacementData(store.template?.defaultPlacement, true),
  );
  const [placementData, setPlacementData] = useState<PlacementData>(() =>
    normalizePlacementData(store.template?.defaultPlacement, true),
  );
  const isDirty = JSON.stringify(initialPlacement) !== JSON.stringify(placementData);

  useEffect(() => {
    setPlacementData(normalizePlacementData(store.template?.defaultPlacement, true));
  }, [store.template?.defaultPlacement]);

  const bgColor = store.colors.find(c => c.enabled)?.hex || "#EEEEEE";

  if (!store.template) return (
    <div className="card" style={{ padding: 40, textAlign: "center" }}>
      <AlertTriangle size={24} style={{ color: "#f59e0b", margin: "0 auto 12px" }} />
      <p style={{ fontWeight: 600 }}>Chưa có Blueprint</p>
      <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>Cấu hình Blueprint & Provider trước.</p>
    </div>
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/template`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPlacement: normalizePlacementData(placementData, false) }),
      });
      if (res.ok) {
        toast.success(`Đã lưu Placement: ${formatPlacementViewDetails(placementData)}`);
        onSave();
      } else { const e = await res.json(); toast.error(e.error || "Lỗi"); }
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, margin: 0 }}><Move size={18} style={{ display: "inline", marginRight: 8 }} />Placement mặc định</h3>
        <button onClick={handleSave} disabled={saving || !isDirty} className="btn btn-primary" title={!isDirty ? "Chưa có thay đổi" : ""}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu Placement
        </button>
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
