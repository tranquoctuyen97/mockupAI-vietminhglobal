import { ArrowRight } from "lucide-react";
import Link from "next/link";

import TripleWhaleDashboard from "./TripleWhaleDashboard";

export default function DashboardClient({ twTimezone }: { twTimezone: string }) {
  return (
    <div>
      <h1
        className="text-section-heading dashboard-heading"
        style={{ color: "var(--text-primary)", marginBottom: 18 }}
      >
        Dashboard
      </h1>

      <TripleWhaleDashboard timezone={twTimezone} />

      <div className="card card-lg" style={{ maxWidth: 400 }}>
        <h2 className="text-feature-title mb-4" style={{ color: "var(--text-primary)" }}>
          Quick start
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { title: "Connect a store", desc: "Shopify + Printify", href: "/stores" },
            { title: "Upload a design", desc: "Add artwork to your library", href: "/designs" },
            { title: "Create a listing", desc: "Launch the listing wizard", href: "/wizard" },
          ].map((action) => (
            <Link
              className="group flex items-center gap-3 transition-all duration-150"
              href={action.href}
              key={action.title}
              style={{
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                color: "inherit",
                padding: "10px 12px",
                textDecoration: "none",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{action.title}</div>
                <div style={{ fontSize: "0.75rem", opacity: 0.5 }}>{action.desc}</div>
              </div>
              <ArrowRight
                className="group-hover:translate-x-1 transition-transform duration-150"
                size={14}
                style={{ opacity: 0.3 }}
              />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
