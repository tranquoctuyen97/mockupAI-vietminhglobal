"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Store,
  Plus,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Palette,
  Settings,
} from "lucide-react";

interface StoreData {
  id: string;
  name: string;
  shopifyDomain: string;
  printifyShopId: string | null;
  status: "ACTIVE" | "TOKEN_EXPIRED" | "ERROR";
  lastHealthCheck: string | null;
  colors: Array<{ id: string; name: string; hex: string }>;
  templates: Array<{ id: string; name: string }>;
  createdAt: string;
}

interface Props {
  initialStores: StoreData[];
  userRole: string;
}

export default function StoresClient({ initialStores, userRole }: Props) {
  const [stores, setStores] = useState<StoreData[]>(initialStores);

  async function fetchStores() {
    try {
      const res = await fetch("/api/stores");
      if (res.ok) {
        const data = await res.json();
        setStores(data);
      }
    } catch {
      // ignore
    }
  }

  async function handleTestConnection(storeId: string) {
    try {
      const res = await fetch(`/api/stores/${storeId}/test-connection`, {
        method: "POST",
      });
      const result = await res.json();
      await fetchStores();
      if (result.status === "ACTIVE") {
        alert("✅ Kết nối OK!");
      } else {
        alert(`⚠️ Có lỗi: ${result.shopify?.error || result.printify?.error}`);
      }
    } catch {
      alert("Lỗi kết nối");
    }
  }

  async function handleDelete(storeId: string, storeName: string) {
    if (!confirm(`Bạn chắc muốn xóa store "${storeName}"?`)) return;
    try {
      await fetch(`/api/stores/${storeId}`, { method: "DELETE" });
      await fetchStores();
    } catch {
      alert("Lỗi khi xóa store");
    }
  }

  function StatusBadge({ status }: { status: StoreData["status"] }) {
    const configs = {
      ACTIVE: { icon: <CheckCircle2 size={14} />, label: "Hoạt động", className: "badge-success" },
      TOKEN_EXPIRED: { icon: <AlertTriangle size={14} />, label: "Token hết hạn", className: "badge-warning" },
      ERROR: { icon: <XCircle size={14} />, label: "Lỗi", className: "badge-danger" },
    };
    const config = configs[status];
    return (
      <span className={`badge ${config.className}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        {config.icon}
        {config.label}
      </span>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">Stores</h1>
          <p className="page-subtitle">Quản lý kết nối Shopify + Printify</p>
        </div>
        {userRole === "ADMIN" && (
          <Link href="/stores/new" className="btn btn-primary">
            <Plus size={16} />
            Kết nối Store
          </Link>
        )}
      </div>

      {/* Store List */}
      {stores.length === 0 ? (
        <div className="card" style={{ padding: "60px", textAlign: "center" }}>
          <Store size={48} style={{ margin: "0 auto", opacity: 0.3, marginBottom: "16px" }} />
          <h3 style={{ marginBottom: "8px", fontWeight: 700 }}>Chưa có Store nào</h3>
          <p style={{ opacity: 0.6, marginBottom: "24px" }}>
            {userRole === "ADMIN" 
              ? "Kết nối Shopify store đầu tiên để bắt đầu tạo sản phẩm"
              : "Vui lòng liên hệ Admin để kết nối Store"}
          </p>
          {userRole === "ADMIN" && (
            <Link href="/stores/new" className="btn btn-primary">
              <Plus size={16} />
              Kết nối Store đầu tiên
            </Link>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: "16px" }}>
          {stores.map((store) => (
            <div key={store.id} className="card" style={{ padding: "24px" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4" style={{ flex: 1 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-tertiary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Store size={22} style={{ opacity: 0.6 }} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div className="flex items-center gap-3" style={{ marginBottom: "4px" }}>
                      <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>{store.name}</span>
                      <StatusBadge status={store.status} />
                    </div>
                    <div style={{ fontSize: "0.875rem", opacity: 0.6 }}>
                      <a
                        href={`https://${store.shopifyDomain}/admin`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1"
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {store.shopifyDomain}
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-6" style={{ fontSize: "0.875rem" }}>
                    <div className="flex items-center gap-2" style={{ opacity: 0.6 }}>
                      <Palette size={14} />
                      <span>{store.colors.length} màu</span>
                    </div>
                    <div style={{ opacity: 0.6 }}>
                      {store.printifyShopId ? "✅ Printify" : "❌ Chưa kết nối Printify"}
                    </div>
                    {store.lastHealthCheck && (
                      <div style={{ opacity: 0.4, fontSize: "0.8rem" }}>
                        Check: {new Date(store.lastHealthCheck).toLocaleDateString("vi-VN")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {userRole === "ADMIN" && (
                    <button
                      onClick={() => handleTestConnection(store.id)}
                      className="btn btn-secondary"
                      title="Test kết nối"
                      style={{ padding: "8px 12px" }}
                    >
                      <RefreshCw size={14} />
                      Test
                    </button>
                  )}
                  <Link
                    href={`/stores/${store.id}/config`}
                    className="btn btn-secondary"
                    style={{ padding: "8px 12px" }}
                  >
                    <Settings size={14} />
                    Cấu hình
                  </Link>
                  {userRole === "ADMIN" && (
                    <button
                      onClick={() => handleDelete(store.id, store.name)}
                      className="btn btn-danger"
                      style={{ padding: "8px 12px" }}
                    >
                      Xóa
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
