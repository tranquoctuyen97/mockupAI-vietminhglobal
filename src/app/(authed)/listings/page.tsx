"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingBag,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Trash2,
} from "lucide-react";

interface Listing {
  id: string;
  title: string;
  status: string;
  priceUsd: number;
  shopifyProductId: string | null;
  printifyProductId: string | null;
  createdAt: string;
  variants: Array<{ id: string; colorName: string; colorHex: string }>;
  publishJobs: Array<{ id: string; stage: string; status: string }>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PUBLISHING: { label: "Publishing...", color: "#3b82f6", icon: <Loader2 size={14} className="animate-spin" /> },
  ACTIVE: { label: "Active", color: "#22c55e", icon: <CheckCircle2 size={14} /> },
  PARTIAL_FAILURE: { label: "Partial Failure", color: "#f59e0b", icon: <AlertTriangle size={14} /> },
  FAILED: { label: "Failed", color: "#ef4444", icon: <XCircle size={14} /> },
};

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PARTIAL_FAILURE", label: "Partial" },
  { key: "FAILED", label: "Failed" },
];

export default function ListingsPage() {
  const router = useRouter();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  async function fetchListings() {
    setLoading(true);
    try {
      const url = `/api/listings?status=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) setListings(data.listings);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchListings();
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(id: string) {
    if (!confirm("Archive listing này?")) return;
    await fetch(`/api/listings/${id}`, { method: "DELETE" });
    fetchListings();
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Listings</h1>
          <p className="page-subtitle">Sản phẩm đã publish</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2" style={{ marginBottom: 20 }}>
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-default)",
              backgroundColor: filter === tab.key ? "var(--color-wise-green)" : "transparent",
              color: filter === tab.key ? "white" : "inherit",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {!loading && listings.length === 0 && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              backgroundColor: "var(--bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <ShoppingBag size={32} style={{ opacity: 0.3 }} />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Chưa có listing nào</h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem" }}>
            Publish từ Wizard để tạo listing đầu tiên
          </p>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border-default)",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  opacity: 0.5,
                }}
              >
                <th style={{ textAlign: "left", padding: "12px 16px" }}>Title</th>
                <th style={{ textAlign: "left", padding: "12px 16px" }}>Colors</th>
                <th style={{ textAlign: "left", padding: "12px 16px" }}>Status</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}>Price</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}>Date</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing, idx) => {
                const statusCfg = STATUS_CONFIG[listing.status] || STATUS_CONFIG.FAILED;
                return (
                  <tr
                    key={listing.id}
                    style={{
                      borderBottom:
                        idx < listings.length - 1
                          ? "1px solid var(--border-default)"
                          : "none",
                      cursor: "pointer",
                    }}
                    onClick={() => router.push(`/listings/${listing.id}`)}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                        {listing.title || "Untitled"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div className="flex gap-1">
                        {listing.variants.slice(0, 5).map((v) => (
                          <div
                            key={v.id}
                            title={v.colorName}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              backgroundColor: v.colorHex,
                              border: "1px solid var(--border-default)",
                            }}
                          />
                        ))}
                        {listing.variants.length > 5 && (
                          <span style={{ fontSize: "0.75rem", opacity: 0.5 }}>
                            +{listing.variants.length - 5}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        className="flex items-center gap-1"
                        style={{
                          color: statusCfg.color,
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                      >
                        {statusCfg.icon} {statusCfg.label}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        textAlign: "right",
                        fontWeight: 600,
                        fontSize: "0.9rem",
                      }}
                    >
                      ${listing.priceUsd.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        textAlign: "right",
                        fontSize: "0.8rem",
                        opacity: 0.5,
                      }}
                    >
                      {new Date(listing.createdAt).toLocaleDateString("vi-VN")}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(listing.id);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 4,
                            color: "var(--color-danger)",
                            opacity: 0.5,
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                        <ExternalLink size={14} style={{ opacity: 0.3 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
