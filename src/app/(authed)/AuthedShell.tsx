"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import TokenExpiredBanner from "@/components/TokenExpiredBanner";
import {
  LayoutDashboard,
  Store,
  Palette,
  Wand2,
  ShoppingBag,
  Users,
  ToggleLeft,
  DollarSign,
  Bot,
  LogOut,
  Sparkles,
  Menu,
  X,
  ChevronRight,
  Puzzle,
} from "lucide-react";

interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  badge?: string;
}

const NAV_ITEMS: NavItemConfig[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Stores", href: "/stores", icon: <Store size={18} /> },
  { label: "Designs", href: "/designs", icon: <Palette size={18} /> },
  { label: "Wizard", href: "/wizard", icon: <Wand2 size={18} /> },
  { label: "Listings", href: "/listings", icon: <ShoppingBag size={18} /> },
];

const ADMIN_ITEMS: NavItemConfig[] = [
  { label: "Users", href: "/admin/users", icon: <Users size={18} />, adminOnly: true },
  { label: "Feature Flags", href: "/admin/feature-flags", icon: <ToggleLeft size={18} />, adminOnly: true },
  { label: "Pricing", href: "/admin/pricing", icon: <DollarSign size={18} />, adminOnly: true },
  { label: "AI Settings", href: "/admin/ai-settings", icon: <Bot size={18} />, adminOnly: true },
];

const INTEGRATION_ITEMS: NavItemConfig[] = [
  { label: "Printify", href: "/integrations/printify", icon: <Puzzle size={18} />, adminOnly: true },
];

/**
 * Client shell: sidebar, topbar, mobile drawer.
 * Receives userRole from Server Component (no client-side fetch needed).
 */
export default function AuthedShell({
  children,
  userRole,
}: {
  children: React.ReactNode;
  userRole: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Đã đăng xuất");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Có lỗi khi đăng xuất");
    } finally {
      setLoggingOut(false);
    }
  }

  function NavItem({ item }: { item: NavItemConfig }) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        href={item.href}
        className={`nav-item ${isActive ? "active" : ""}`}
        onClick={() => setSidebarOpen(false)}
      >
        {item.icon}
        <span className="flex-1">{item.label}</span>
        {item.badge && (
          <span style={{
            fontSize: "0.625rem",
            padding: "1px 6px",
            borderRadius: "var(--radius-pill)",
            backgroundColor: isActive ? "rgba(22,51,0,0.15)" : "rgba(255,255,255,0.12)",
            fontWeight: 600,
            lineHeight: 1.6,
          }}>
            {item.badge}
          </span>
        )}
        {isActive && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
      </Link>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar fixed lg:sticky top-0 z-50 transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 mb-6">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-wise-green)" }}
          >
            <Sparkles size={16} style={{ color: "var(--color-wise-dark-green)" }} />
          </div>
          <span style={{ fontWeight: 900, fontSize: "1.25rem", letterSpacing: "-0.5px" }}>
            MockupAI
          </span>
          {/* Mobile close */}
          <button
            className="lg:hidden ml-auto p-1"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Main nav */}
        <nav className="flex-1 space-y-0.5">
          <div className="px-5 mb-2">
            <span className="text-small" style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Workspace
            </span>
          </div>
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}

          {/* Integrations section (ADMIN only) */}
          {userRole === "ADMIN" && (
            <>
              <div className="px-5 mt-6 mb-2">
                <span className="text-small" style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Integrations
                </span>
              </div>
              {INTEGRATION_ITEMS.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </>
          )}

          {/* Admin section */}
          {userRole === "ADMIN" && (
            <>
              <div className="px-5 mt-6 mb-2">
                <span className="text-small" style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Admin
                </span>
              </div>
              {ADMIN_ITEMS.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </>
          )}
        </nav>

        {/* Logout */}
        <div className="mt-auto px-3 pb-2">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="nav-item w-full"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <LogOut size={18} />
            <span>{loggingOut ? "Đang xuất..." : "Đăng xuất"}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Top bar (mobile) */}
        <header
          className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 lg:hidden"
          style={{
            backgroundColor: "var(--bg-primary)",
            borderBottom: "1px solid var(--border-default)",
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5"
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-default)",
            }}
            aria-label="Open sidebar"
          >
            <Menu size={18} />
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem" }}>MockupAI</span>
        </header>

        {/* Page content */}
        <div className="p-6 lg:p-8 max-w-7xl">
          <TokenExpiredBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
