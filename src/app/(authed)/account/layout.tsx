import Link from "next/link";
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";

const TABS = [
  { href: "/account", label: "Profile" },
  { href: "/account/permissions", label: "Permissions" },
  { href: "/account/stores", label: "Stores" },
  { href: "/account/mcp", label: "MCP" },
  { href: "/account/mcp/tools", label: "Tools" },
  { href: "/account/mcp/audit", label: "Audit" },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await validateSession();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption" style={{ color: "var(--text-muted)" }}>
          PERSONAL SETTINGS
        </p>
        <h1 className="text-section-heading">Account</h1>
        <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
          Your identity, inherited access, stores, and personal MCP connection.
        </p>
      </div>
      <nav
        aria-label="Account sections"
        className="flex flex-wrap gap-2 border-b pb-3"
        style={{ borderColor: "var(--border-default)" }}
      >
        {TABS.map((tab) => (
          <Link className="btn-secondary btn-sm" href={tab.href} key={tab.href}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
