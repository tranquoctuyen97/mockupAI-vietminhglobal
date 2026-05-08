"use client";

import {
  Palette,
  ShoppingBag,
  BarChart3,
  DollarSign,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

interface Summary {
  designs: number;
  listings: number;
  ordersToday: number;
  revenueToday: number;
}

interface Props {
  summary: Summary;
}

export default function DashboardClient({ summary }: Props) {
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

      {/* Quick Actions */}
      <div className="card card-lg" style={{ maxWidth: 400 }}>
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
  );
}
