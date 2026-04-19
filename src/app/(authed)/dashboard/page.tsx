"use client";

import { useEffect, useState } from "react";
import {
  Palette,
  ShoppingBag,
  BarChart3,
  DollarSign,
  ArrowRight,
  TrendingUp,
  Image as ImageIcon,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Summary {
  designs: number;
  listings: number;
  ordersToday: number;
  revenueToday: number;
}

interface OrderDay {
  date: string;
  count: number;
  revenue: number;
}

interface TopDesign {
  listingId: string;
  listingTitle: string;
  designName: string;
  previewPath: string | null;
  orderCount: number;
  revenue: number;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chartData, setChartData] = useState<OrderDay[]>([]);
  const [topDesigns, setTopDesigns] = useState<TopDesign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchJson = async (url: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch (err) {
        return null;
      }
    };

    Promise.all([
      fetchJson("/api/dashboard/summary"),
      fetchJson("/api/dashboard/orders-by-day"),
      fetchJson("/api/dashboard/top-designs?limit=10"),
    ])
      .then(([s, c, t]) => {
        setSummary(s || { designs: 0, listings: 0, ordersToday: 0, revenueToday: 0 });
        setChartData(c || []);
        setTopDesigns(t || []);
      })
      .catch((err) => {
        console.error("Failed to load dashboard data:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const stats = [
    {
      label: "Designs",
      value: summary?.designs ?? "—",
      icon: <Palette size={20} />,
      color: "#9fe870",
      href: "/designs",
    },
    {
      label: "Active Listings",
      value: summary?.listings ?? "—",
      icon: <ShoppingBag size={20} />,
      color: "#ffc091",
      href: "/listings",
    },
    {
      label: "Orders hôm nay",
      value: summary?.ordersToday ?? "—",
      icon: <BarChart3 size={20} />,
      color: "#38c8ff",
    },
    {
      label: "Revenue hôm nay",
      value:
        summary != null
          ? `$${summary.revenueToday.toFixed(2)}`
          : "—",
      icon: <DollarSign size={20} />,
      color: "#ffd11a",
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-section-heading"
          style={{ color: "var(--text-primary)" }}
        >
          Dashboard
        </h1>
        <p
          className="text-body mt-2"
          style={{ color: "var(--text-secondary)" }}
        >
          Tổng quan hoạt động kinh doanh
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => {
          const Inner = (
            <div className="card card-sm" key={stat.label}>
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-caption"
                  style={{
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  {stat.label}
                </span>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: `${stat.color}20`,
                    color: stat.color,
                  }}
                >
                  {stat.icon}
                </div>
              </div>
              <div
                className="text-sub-heading"
                style={{ color: "var(--text-primary)" }}
              >
                {loading ? (
                  <span style={{ opacity: 0.3 }}>...</span>
                ) : (
                  stat.value
                )}
              </div>
            </div>
          );

          return stat.href ? (
            <Link key={stat.label} href={stat.href} style={{ textDecoration: "none" }}>
              {Inner}
            </Link>
          ) : (
            <div key={stat.label}>{Inner}</div>
          );
        })}
      </div>

      {/* Orders Chart */}
      <div className="card card-lg mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-feature-title"
            style={{ color: "var(--text-primary)" }}
          >
            <TrendingUp
              size={18}
              style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }}
            />
            Orders / Ngày (30 ngày)
          </h2>
        </div>

        <div style={{ width: "100%", height: 280 }}>
          {loading ? (
            <div
              className="flex items-center justify-center"
              style={{ height: "100%", opacity: 0.3 }}
            >
              Đang tải...
            </div>
          ) : chartData.length === 0 ? (
            <div
              className="flex items-center justify-center"
              style={{
                height: "100%",
                opacity: 0.4,
                fontSize: "0.9rem",
              }}
            >
              Chưa có dữ liệu orders. Kết nối store + tạo test order để bắt đầu.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#9fe870" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#9fe870" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                />
                <XAxis
                  dataKey="date"
                  stroke="rgba(255,255,255,0.3)"
                  fontSize={11}
                  tickFormatter={(val: string) => {
                    const d = new Date(val);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.3)"
                  fontSize={11}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1b1c1e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#f9f9f9" }}
                  itemStyle={{ color: "#9fe870" }}
                  formatter={(value: unknown) => [String(value), "Orders"]}
                  labelFormatter={(label: unknown) => {
                    const d = new Date(String(label));
                    return d.toLocaleDateString("vi-VN");
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#9fe870"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorOrders)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top Designs + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Designs */}
        <div className="card card-lg lg:col-span-2">
          <h2
            className="text-feature-title mb-4"
            style={{ color: "var(--text-primary)" }}
          >
            Top Designs
          </h2>

          {loading ? (
            <div style={{ opacity: 0.3, padding: "24px 0" }}>Đang tải...</div>
          ) : topDesigns.length === 0 ? (
            <div
              style={{
                opacity: 0.4,
                padding: "24px 0",
                textAlign: "center",
                fontSize: "0.85rem",
              }}
            >
              Chưa có orders nào. Dữ liệu sẽ xuất hiện khi có đơn hàng.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {topDesigns.map((d, i) => (
                <div
                  key={d.listingId}
                  className="flex items-center gap-3"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor:
                      i === 0 ? "rgba(159, 232, 112, 0.06)" : "transparent",
                    border:
                      i === 0
                        ? "1px solid rgba(159, 232, 112, 0.1)"
                        : "1px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      textAlign: "center",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      color:
                        i < 3
                          ? "var(--color-wise-green)"
                          : "var(--text-muted)",
                    }}
                  >
                    #{i + 1}
                  </span>
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-tertiary)",
                      flexShrink: 0,
                    }}
                  >
                    {d.previewPath ? (
                      <img
                        src={d.previewPath}
                        alt={d.designName}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "var(--radius-sm)",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <ImageIcon size={16} style={{ opacity: 0.3 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {d.designName}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.85rem",
                        color: "var(--color-wise-green)",
                      }}
                    >
                      {d.orderCount} orders
                    </div>
                    <div
                      style={{ fontSize: "0.75rem", opacity: 0.5 }}
                    >
                      ${d.revenue.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card card-lg">
          <h2
            className="text-feature-title mb-4"
            style={{ color: "var(--text-primary)" }}
          >
            Bắt đầu nhanh
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              {
                title: "Kết nối Store",
                desc: "Shopify + Printify",
                href: "/stores",
              },
              {
                title: "Upload Design",
                desc: "Tải lên thiết kế",
                href: "/designs",
              },
              {
                title: "Tạo Listing",
                desc: "Wizard 7 bước",
                href: "/wizard",
              },
            ].map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="group flex items-center gap-3 transition-all duration-150"
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-sm)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "0.85rem",
                    }}
                  >
                    {action.title}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      opacity: 0.5,
                    }}
                  >
                    {action.desc}
                  </div>
                </div>
                <ArrowRight
                  size={14}
                  style={{ opacity: 0.3 }}
                  className="group-hover:translate-x-1 transition-transform duration-150"
                />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
