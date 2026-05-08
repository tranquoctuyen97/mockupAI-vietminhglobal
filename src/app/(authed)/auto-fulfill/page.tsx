import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/auth/roles";
import Link from "next/link";

export default async function AutoFulfillPage() {
  const session = await validateSession();

  // Check if InkHub credentials are configured
  const row = session
    ? await prisma.inkhubCredential.findUnique({ where: { tenantId: session.tenantId } })
    : null;
  const isConfigured = !!row;

  if (!isConfigured) {
    const canConfig = session
      ? await hasFeature(session.tenantId, session.role, "inkhub_config")
      : false;

    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ backgroundColor: "var(--bg-primary)" }}
      >
        <div className="text-center" style={{ maxWidth: 400, padding: "40px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px", opacity: 0.3 }}>🔌</div>
          <p className="text-body" style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            Vui lòng liên hệ admin để config account
          </p>
          {canConfig && (
            <Link href="/admin/inkhub" className="btn btn-primary">
              Cấu hình ngay
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <iframe
      src="/api/inkhub-proxy/"
      title="Auto Fulfill"
      className="w-full h-full border-0 block"
    />
  );
}
