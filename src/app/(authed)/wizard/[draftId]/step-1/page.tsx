"use client";

import { useState, useEffect, useCallback } from "react";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  Store as StoreIcon,
  Check,
  Loader2,
  Search,
  AlertCircle,
  Link2,
} from "lucide-react";

interface StoreItem {
  id: string;
  name: string;
  shopifyDomain: string;
  printifyShopId: string | null;
  status: string;
}

export default function Step1StorePage() {
  const { draft, updateDraft } = useWizardStore();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stores");
      const data = await res.json();
      if (res.ok) setStores(Array.isArray(data) ? data : data.stores || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const filtered = stores.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.shopifyDomain.toLowerCase().includes(q)
    );
  });

  function handleSelect(storeId: string) {
    updateDraft({
      storeId,
      // Reset downstream selections when store changes
      blueprintId: null,
      printProviderId: null,
      selectedColors: [],
    });
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Chọn Store
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn store Shopify để tạo listing
      </p>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search
          size={16}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }}
        />
        <input
          type="text"
          className="input"
          placeholder="Tìm store..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 38 }}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center" style={{ padding: 48, opacity: 0.5 }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <StoreIcon size={32} style={{ opacity: 0.3, margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 600 }}>Chưa có store nào</p>
          <p style={{ opacity: 0.5, fontSize: "0.85rem" }}>
            <a href="/stores/new" style={{ color: "var(--color-wise-green)", fontWeight: 600 }}>
              Kết nối store Shopify
            </a>{" "}
            trước rồi quay lại
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {filtered.map((s) => {
            const isSelected = draft?.storeId === s.id;
            const hasPrintify = !!s.printifyShopId;
            const isActive = s.status === "ACTIVE";

            return (
              <div
                key={s.id}
                onClick={() => {
                  if (!hasPrintify) return; // Can't select stores without Printify
                  handleSelect(s.id);
                }}
                className="card"
                style={{
                  padding: "16px 20px",
                  cursor: hasPrintify ? "pointer" : "not-allowed",
                  border: isSelected
                    ? "2px solid var(--color-wise-green)"
                    : "1px solid var(--border-default)",
                  transition: "all 0.15s",
                  position: "relative",
                  opacity: hasPrintify ? 1 : 0.5,
                }}
              >
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      backgroundColor: "var(--color-wise-green)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Check size={14} color="white" />
                  </div>
                )}

                <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-tertiary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <StoreIcon size={18} style={{ opacity: 0.4 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontWeight: 600,
                        fontSize: "0.9rem",
                        margin: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.name}
                    </p>
                    <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: "2px 0 0" }}>
                      {s.shopifyDomain}
                    </p>
                  </div>
                </div>

                {/* Status badges */}
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 99,
                      backgroundColor: isActive
                        ? "rgba(34, 197, 94, 0.1)"
                        : "rgba(239, 68, 68, 0.1)",
                      color: isActive ? "#22c55e" : "#ef4444",
                    }}
                  >
                    {isActive ? "Active" : s.status}
                  </span>

                  {hasPrintify ? (
                    <span
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 99,
                        backgroundColor: "rgba(59, 130, 246, 0.1)",
                        color: "#3b82f6",
                      }}
                      className="flex items-center gap-1"
                    >
                      <Link2 size={10} /> Printify
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-1"
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 500,
                        padding: "2px 8px",
                        borderRadius: 99,
                        backgroundColor: "rgba(245, 158, 11, 0.1)",
                        color: "#f59e0b",
                      }}
                    >
                      <AlertCircle size={10} /> Chưa kết nối Printify
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
