"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Store,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Palette,
  Save,
} from "lucide-react";
import Link from "next/link";

interface StoreDetail {
  id: string;
  name: string;
  shopifyDomain: string;
  printifyShopId: string | null;
  status: string;
  colors: Array<{ id: string; name: string; hex: string; printifyColorId: string | null; sortOrder: number }>;
  templates: Array<{ id: string; name: string; printifyBlueprintId: number; printifyPrintProviderId: number; position: string }>;
}

interface PrintifyShop {
  id: number;
  title: string;
}

type Tab = "printify" | "colors" | "templates" | "settings";

function StoreConfigContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeId = params.id as string;
  const initialStep = (searchParams.get("step") as Tab) || "settings";
  const justConnected = searchParams.get("connected");

  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>(initialStep);

  useEffect(() => {
    fetchStore();
    if (justConnected === "shopify") {
      toast.success("✅ Shopify đã kết nối thành công!");
    }
  }, []);

  async function fetchStore() {
    setLoading(true);
    try {
      const res = await fetch("/api/stores");
      if (res.ok) {
        const stores = await res.json();
        const found = stores.find((s: StoreDetail) => s.id === storeId);
        setStore(found || null);
      }
    } finally {
      setLoading(false);
    }
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
        <Link href="/stores" className="btn btn-secondary" style={{ marginTop: 16 }}>
          Quay lại
        </Link>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "settings", label: "Tổng quan" },
    { key: "printify", label: "Printify" },
    { key: "colors", label: "Màu sắc" },
    { key: "templates", label: "Templates" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
        <Link href="/stores" style={{ opacity: 0.5 }}>
          <ArrowLeft size={18} />
        </Link>
        <h1 className="page-title" style={{ margin: 0 }}>
          {store.name}
        </h1>
        <span className="badge badge-success" style={{ fontSize: "0.7rem" }}>
          {store.shopifyDomain}
        </span>
      </div>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        Cấu hình kết nối và tùy chỉnh store
      </p>

      {/* Tab bar */}
      <div
        className="flex items-center gap-1"
        style={{
          borderBottom: "2px solid var(--border-default)",
          marginBottom: 32,
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 20px",
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: "0.875rem",
              borderBottom: activeTab === tab.key ? "2px solid var(--color-wise-green)" : "2px solid transparent",
              marginBottom: -2,
              backgroundColor: "transparent",
              cursor: "pointer",
              opacity: activeTab === tab.key ? 1 : 0.6,
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "settings" && <SettingsTab store={store} onRefresh={fetchStore} />}
      {activeTab === "printify" && <PrintifyTab store={store} onRefresh={fetchStore} />}
      {activeTab === "colors" && <ColorsTab store={store} onRefresh={fetchStore} />}
      {activeTab === "templates" && <TemplatesTab store={store} />}
    </div>
  );
}

export default function StoreConfigPage() {
  return (
    <Suspense
      fallback={
        <div style={{ textAlign: "center", padding: 60 }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto" }} />
        </div>
      }
    >
      <StoreConfigContent />
    </Suspense>
  );
}

/* ========== Settings Tab ========== */
function SettingsTab({ store, onRefresh }: { store: StoreDetail; onRefresh: () => void }) {
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/test-connection`, { method: "POST" });
      const result = await res.json();
      if (result.status === "ACTIVE") {
        toast.success("Kết nối OK!");
      } else {
        toast.error(`Lỗi: ${result.shopify?.error || result.printify?.error}`);
      }
      onRefresh();
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="card" style={{ padding: 32 }}>
      <div style={{ display: "grid", gap: 20 }}>
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600 }}>Shopify Domain</span>
          <span style={{ opacity: 0.7 }}>{store.shopifyDomain}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600 }}>Printify</span>
          <span style={{ opacity: 0.7 }}>
            {store.printifyShopId ? `Shop #${store.printifyShopId}` : "Chưa kết nối"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600 }}>Trạng thái</span>
          <span className={`badge ${store.status === "ACTIVE" ? "badge-success" : "badge-warning"}`}>
            {store.status}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600 }}>Màu sắc</span>
          <span style={{ opacity: 0.7 }}>{store.colors.length} màu</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600 }}>Templates</span>
          <span style={{ opacity: 0.7 }}>{store.templates.length} template</span>
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        <button onClick={handleTest} disabled={testing} className="btn btn-secondary">
          {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Test kết nối
        </button>
      </div>
    </div>
  );
}

/* ========== Printify Tab ========== */
function PrintifyTab({ store, onRefresh }: { store: StoreDetail; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [shops, setShops] = useState<PrintifyShop[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testOk, setTestOk] = useState(false);

  async function handleTest() {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestOk(false);
    try {
      // We test by calling Printify directly (via our proxy later)
      // For now, we'll save and let the backend test
      const res = await fetch(`/api/stores/${store.id}/printify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), shopId: "test" }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Lỗi kết nối");
        return;
      }
      setTestOk(true);
      toast.success("Kết nối Printify OK!");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim() || !selectedShop) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/printify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), shopId: selectedShop }),
      });
      if (res.ok) {
        toast.success("Đã lưu Printify API key!");
        onRefresh();
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi");
      }
    } finally {
      setSaving(false);
    }
  }

  if (store.printifyShopId) {
    return (
      <div className="card" style={{ padding: 32 }}>
        <div className="flex items-center gap-3">
          <CheckCircle2 size={20} style={{ color: "var(--color-wise-green)" }} />
          <div>
            <p style={{ fontWeight: 700, margin: 0 }}>Printify đã kết nối</p>
            <p style={{ opacity: 0.6, fontSize: "0.875rem", margin: 0 }}>
              Shop ID: {store.printifyShopId}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 32 }}>
      <h3 style={{ fontWeight: 700, marginBottom: 20 }}>Kết nối Printify</h3>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="printify-key" style={{ display: "block", fontWeight: 600, marginBottom: 8, fontSize: "0.875rem" }}>
          Printify API Key
        </label>
        <input
          id="printify-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Nhập API key từ Printify Settings → Connections"
          className="input"
          style={{ width: "100%" }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving || !apiKey.trim()} className="btn btn-primary">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Lưu
        </button>
      </div>

      <p style={{ fontSize: "0.75rem", opacity: 0.5, marginTop: 12 }}>
        Lấy API key: Printify → Account → Connections → Personal Access Token
      </p>
    </div>
  );
}

/* ========== Colors Tab ========== */
function ColorsTab({ store, onRefresh }: { store: StoreDetail; onRefresh: () => void }) {
  const [colors, setColors] = useState(
    store.colors.map((c) => ({ name: c.name, hex: c.hex, printifyColorId: c.printifyColorId || "" })),
  );
  const [saving, setSaving] = useState(false);

  function addColor() {
    setColors([...colors, { name: "", hex: "#000000", printifyColorId: "" }]);
  }

  function removeColor(index: number) {
    setColors(colors.filter((_, i) => i !== index));
  }

  function updateColor(index: number, field: string, value: string) {
    const updated = [...colors];
    updated[index] = { ...updated[index], [field]: value };
    setColors(updated);
  }

  async function handleSave() {
    const validColors = colors.filter((c) => c.name.trim() && c.hex.trim());
    if (validColors.length === 0) {
      toast.error("Cần ít nhất 1 màu");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/colors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colors: validColors.map((c, i) => ({
            name: c.name.trim(),
            hex: c.hex,
            printifyColorId: c.printifyColorId || undefined,
            sortOrder: i,
          })),
        }),
      });
      if (res.ok) {
        toast.success("Đã lưu màu sắc!");
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, margin: 0 }}>
          <Palette size={18} style={{ display: "inline", marginRight: 8 }} />
          Bảng màu ({colors.length})
        </h3>
        <button onClick={addColor} className="btn btn-secondary" style={{ padding: "6px 12px" }}>
          <Plus size={14} />
          Thêm màu
        </button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {colors.map((color, i) => (
          <div
            key={`color-${i}`}
            className="card flex items-center gap-3"
            style={{ padding: "12px 16px" }}
          >
            <input
              type="color"
              value={color.hex}
              onChange={(e) => updateColor(i, "hex", e.target.value)}
              style={{ width: 36, height: 36, border: "none", cursor: "pointer", borderRadius: 6 }}
            />
            <input
              type="text"
              value={color.name}
              onChange={(e) => updateColor(i, "name", e.target.value)}
              placeholder="Tên màu (VD: Đen)"
              className="input"
              style={{ flex: 1 }}
            />
            <input
              type="text"
              value={color.hex}
              onChange={(e) => updateColor(i, "hex", e.target.value)}
              className="input"
              style={{ width: 90 }}
            />
            <button
              onClick={() => removeColor(i)}
              style={{
                padding: 6,
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                opacity: 0.4,
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {colors.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Lưu màu sắc
          </button>
        </div>
      )}
    </div>
  );
}

/* ========== Templates Tab ========== */
function TemplatesTab({ store }: { store: StoreDetail }) {
  if (store.templates.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <AlertTriangle size={32} style={{ margin: "0 auto", opacity: 0.3, marginBottom: 12 }} />
        <p style={{ fontWeight: 600 }}>Chưa có template</p>
        <p style={{ opacity: 0.6, fontSize: "0.875rem" }}>
          Template sẽ được cấu hình khi tạo mockup (Phase 3)
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {store.templates.map((t) => (
        <div key={t.id} className="card" style={{ padding: 16 }}>
          <div className="flex items-center justify-between">
            <span style={{ fontWeight: 600 }}>{t.name}</span>
            <span className="badge" style={{ opacity: 0.6 }}>
              Blueprint #{t.printifyBlueprintId} / Provider #{t.printifyPrintProviderId}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
