import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureAiHubWorkspaces } from "@/lib/ai-hub/workspaces";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";

export const metadata = {
  title: "AI Hub — MockupAI",
};

export default async function AiHubPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const canAccess = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>🔒</div>
          <p className="text-body" style={{ color: "var(--text-secondary)" }}>
            Bạn không có quyền truy cập AI Hub.
          </p>
        </div>
      </div>
    );
  }

  try {
    await ensureAiHubWorkspaces({ id: session.id, tenantId: session.tenantId });
  } catch (error) {
    console.error("[AI_HUB] workspace bootstrap failed", error);
    const isAdmin = session.role === "ADMIN" || session.role === "SUPER_ADMIN";
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ maxWidth: 480, padding: 40 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>⚠️</div>
          <p className="text-body" style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            AI Hub chưa sẵn sàng. Vui lòng thử lại hoặc liên hệ admin.
          </p>
          {isAdmin && (
            <Link href="/admin/ai-hub" className="btn btn-primary">
              Mở AI Hub Admin
            </Link>
          )}
        </div>
      </div>
    );
  }

  const iframeSrc = process.env.AI_HUB_IFRAME_URL ?? "/api/codex-proxy/";

  return (
    <iframe
      src={iframeSrc}
      title="AI Hub"
      className="w-full h-full border-0 block"
    />
  );
}
