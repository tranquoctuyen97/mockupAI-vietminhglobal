"use client";

import dynamic from "next/dynamic";
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

const DashboardChart = dynamic(() => import("./DashboardChart"), {
  loading: () => <div className="skeleton" style={{ width: "100%", height: 280 }} />,
  ssr: false,
});

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

interface Props {
  summary: Summary;
  chartData: OrderDay[];
  topDesigns: TopDesign[];
}

export default function DashboardClient({ summary, chartData, topDesigns }: Props) {
  const stats = [
    {
      label: "Designs",
      value: summary.designs,
      icon: <Palette size={20} />,
      color: "#9fe870",
      href: "/designs",
    },
    {
      label: "Active Listings",
      value: summary.listings,
      icon: <ShoppingBag size={20} />,
      color: "#ffc091",
      href: "/listings",
    },
    {
      label: "Orders hôm nay",
      value: summary.ordersToday,
      icon: <BarChart3 size={20} />,
      color: "#38c8ff",
    },
    {
      label: "Revenue hôm nay",
      value: `$${summary.revenueToday.toFixed(2)}`,
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
                {stat.value}
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
          {chartData.length === 0 ? (
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
            <DashboardChart data={chartData} />
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

          {topDesigns.length === 0 ? (
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
                desc: "Wizard 5 bước",
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
