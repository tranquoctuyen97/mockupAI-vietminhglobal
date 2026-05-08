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
  Truck,
  Users,
  DollarSign,
  Bot,
  LogOut,
  Sparkles,
  Menu,
  X,
  ChevronRight,
  Puzzle,
  ArrowLeft,
  Shield,
  Settings,
} from "lucide-react";

interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  badge?: string;
  feature?: string;
}

const NAV_ITEMS: NavItemConfig[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Stores", href: "/stores", icon: <Store size={18} />, feature: "stores" },
  { label: "Designs", href: "/designs", icon: <Palette size={18} />, feature: "designs" },
  { label: "Wizard", href: "/wizard", icon: <Wand2 size={18} />, feature: "wizard" },
  { label: "Listings", href: "/listings", icon: <ShoppingBag size={18} />, feature: "listings" },
  { label: "Auto Fulfill", href: "/auto-fulfill", icon: <Truck size={18} />, feature: "auto_fulfill" },
];

const ADMIN_ITEMS: NavItemConfig[] = [
  { label: "Users", href: "/admin/users", icon: <Users size={18} />, adminOnly: true, feature: "users" },
  { label: "Pricing", href: "/admin/pricing", icon: <DollarSign size={18} />, adminOnly: true, feature: "pricing" },
  { label: "AI Settings", href: "/admin/ai-settings", icon: <Bot size={18} />, adminOnly: true, feature: "ai_settings" },
  { label: "Permissions", href: "/admin/acl", icon: <Shield size={18} />, superAdminOnly: true },
];

const INTEGRATION_ITEMS: NavItemConfig[] = [
  { label: "Printify", href: "/integrations/printify", icon: <Puzzle size={18} />, adminOnly: true, feature: "integrations" },
  { label: "InkHub Config", href: "/admin/inkhub", icon: <Settings size={18} />, adminOnly: true, feature: "inkhub_config" },
];

export default function AuthedShell({
  children,
  userRole,
  permissions,
}: {
  children: React.ReactNode;
  userRole: string;
  permissions: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isAdminOrAbove = userRole === "ADMIN" || isSuperAdmin;

  function canSee(item: NavItemConfig): boolean {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (item.adminOnly && !isAdminOrAbove) return false;
    if (item.feature && !isSuperAdmin && !permissions.includes(item.feature)) return false;
    return true;
  }

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

  if (pathname.startsWith("/auto-fulfill")) {
    return (
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "var(--bg-primary)" }}>
        <aside
          className="w-14 flex-shrink-0 flex flex-col items-center pt-4 pb-4 gap-3"
          style={{ backgroundColor: "var(--bg-sidebar)", borderRight: "1px solid var(--border-default)" }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-wise-green)" }}
          >
            <Sparkles size={16} style={{ color: "var(--color-wise-dark-green)" }} />
          </div>
          <Link
            href="/dashboard"
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-wise-green)" }}
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={16} style={{ color: "var(--color-wise-dark-green)" }} />
          </Link>
        </aside>
        <main className="flex-1 min-w-0 h-full">
          {children}
        </main>
      </div>
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
          {NAV_ITEMS.filter(canSee).map((item) => (
            <NavItem key={item.href} item={item} />
          ))}

          {/* Integrations section */}
          {isAdminOrAbove && INTEGRATION_ITEMS.some(canSee) && (
            <>
              <div className="px-5 mt-6 mb-2">
                <span className="text-small" style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Integrations
                </span>
              </div>
              {INTEGRATION_ITEMS.filter(canSee).map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </>
          )}

          {/* Admin section */}
          {isAdminOrAbove && ADMIN_ITEMS.some(canSee) && (
            <>
              <div className="px-5 mt-6 mb-2">
                <span className="text-small" style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Admin
                </span>
              </div>
              {ADMIN_ITEMS.filter(canSee).map((item) => (
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
