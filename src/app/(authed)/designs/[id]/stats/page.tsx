"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ShoppingBag,
  DollarSign,
  Package,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

interface DesignStats {
  design: {
    id: string;
    name: string;
    previewPath: string | null;
  };
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  listings: Array<{
    id: string;
    title: string;
    status: string;
    shopifyProductId: string | null;
  }>;
  recentOrders: Array<{
    id: string;
    shopifyOrderNumber: string | null;
    totalUsd: number;
    customerEmail: string | null;
    createdAt: string;
    fulfillmentStatus: string;
  }>;
}

export default function DesignStatsPage() {
  const params = useParams();
  const designId = params.id as string;

  const [stats, setStats] = useState<DesignStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/designs/${designId}/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [designId]);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center", opacity: 0.3 }}>
        Đang tải...
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        Không tìm thấy design
      </div>
    );
  }

  const statCards = [
    {
      label: "Total Orders",
      value: stats.totalOrders,
      icon: <ShoppingBag size={18} />,
      color: "#38c8ff",
    },
    {
      label: "Revenue",
      value: `$${stats.totalRevenue.toFixed(2)}`,
      icon: <DollarSign size={18} />,
      color: "#ffd11a",
    },
    {
      label: "Listings",
      value: stats.listings.length,
      icon: <Package size={18} />,
      color: "#9fe870",
    },
    {
      label: "Avg Order Value",
      value: `$${stats.avgOrderValue.toFixed(2)}`,
      icon: <TrendingUp size={18} />,
      color: "#ffc091",
    },
  ];

  const statusColor: Record<string, string> = {
    UNFULFILLED: "var(--color-warning, #ffbc33)",
    FULFILLED: "var(--color-wise-green, #9fe870)",
    PARTIAL: "var(--color-info, #38c8ff)",
    ACTIVE: "var(--color-wise-green, #9fe870)",
    FAILED: "var(--color-error, #ef4444)",
    PARTIAL_FAILURE: "var(--color-warning, #ffbc33)",
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/designs"
          style={{ color: "inherit", opacity: 0.5, display: "flex" }}
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-4">
          {stats.design.previewPath && (
            <img
              src={stats.design.previewPath}
              alt={stats.design.name}
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--radius-md)",
                objectFit: "cover",
                border: "1px solid var(--border-default)",
              }}
            />
          )}
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>
              {stats.design.name}
            </h1>
            <p className="page-subtitle" style={{ margin: 0 }}>
              Thống kê chi tiết
            </p>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((s) => (
          <div className="card card-sm" key={s.label}>
            <div className="flex items-center justify-between mb-2">
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  opacity: 0.5,
                }}
              >
                {s.label}
              </span>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${s.color}20`,
                  color: s.color,
                }}
              >
                {s.icon}
              </div>
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Listings */}
      <div className="card card-lg mb-6">
        <h2
          className="text-feature-title mb-4"
          style={{ color: "var(--text-primary)" }}
        >
          Linked Listings ({stats.listings.length})
        </h2>
        {stats.listings.length === 0 ? (
          <p style={{ opacity: 0.4, fontSize: "0.85rem" }}>
            Chưa có listing nào từ design này
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.listings.map((l) => (
              <Link
                key={l.id}
                href={`/listings/${l.id}`}
                className="flex items-center justify-between"
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-tertiary)",
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ fontWeight: 600 }}>{l.title}</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: statusColor[l.status] || "var(--text-muted)",
                  }}
                >
                  {l.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Orders */}
      <div className="card card-lg">
        <h2
          className="text-feature-title mb-4"
          style={{ color: "var(--text-primary)" }}
        >
          Recent Orders
        </h2>
        {stats.recentOrders.length === 0 ? (
          <p style={{ opacity: 0.4, fontSize: "0.85rem" }}>
            Chưa có đơn hàng nào
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-default)",
                  }}
                >
                  {["Order #", "Customer", "Total", "Status", "Ngày"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          opacity: 0.5,
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {stats.recentOrders.map((o) => (
                  <tr
                    key={o.id}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      {o.shopifyOrderNumber || "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: "0.8rem",
                        opacity: 0.6,
                      }}
                    >
                      {o.customerEmail || "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      ${o.totalUsd.toFixed(2)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color:
                            statusColor[o.fulfillmentStatus] ||
                            "var(--text-muted)",
                        }}
                      >
                        {o.fulfillmentStatus}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: "0.8rem",
                        opacity: 0.5,
                      }}
                    >
                      {new Date(o.createdAt).toLocaleDateString("vi-VN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
