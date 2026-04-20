"use client";

import Link from "next/link";
import { Store, ArrowRight, Puzzle } from "lucide-react";

const INTEGRATIONS = [
  {
    id: "printify",
    name: "Printify",
    description: "Print-on-demand fulfillment. Kết nối API key để tạo sản phẩm và xử lý đơn hàng tự động.",
    href: "/integrations/printify",
    icon: <Store size={24} />,
    color: "#4caf50",
  },
];

export default function IntegrationsPage() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
          <Puzzle size={24} style={{ color: "var(--color-wise-green)" }} />
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>Integrations</h1>
        </div>
        <p style={{ opacity: 0.6, margin: 0 }}>Quản lý các kết nối API bên ngoài (Printify, Gelato, ...)</p>
      </div>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {INTEGRATIONS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="card"
            style={{
              padding: 24,
              display: "flex",
              alignItems: "flex-start",
              gap: 16,
              textDecoration: "none",
              color: "inherit",
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "";
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: `${item.color}20`,
                color: item.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {item.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <h3 style={{ fontWeight: 700, margin: 0, fontSize: "1.05rem" }}>{item.name}</h3>
                <ArrowRight size={14} style={{ opacity: 0.4 }} />
              </div>
              <p style={{ opacity: 0.6, fontSize: "0.85rem", margin: 0, lineHeight: 1.5 }}>
                {item.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
