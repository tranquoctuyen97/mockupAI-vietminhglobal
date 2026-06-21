import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import MailboxesClient from "./MailboxesClient";

export const metadata = {
  title: "Mailboxes — MockupAI",
  description: "Quản lý email từ nhiều mailbox trong một giao diện",
};

export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");
  const { storeId } = await searchParams;

  const canAccess = await hasFeature(session.tenantId, session.role, "mailboxes");
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <div className="text-center" style={{ maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>🔒</div>
          <p className="text-body" style={{ color: "var(--text-secondary)" }}>
            Bạn không có quyền truy cập Mailboxes.
          </p>
        </div>
      </div>
    );
  }

  // Fetch active stores for the tenant to populate the store selector
  const stores = await prisma.store.findMany({
    where: {
      tenantId: session.tenantId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true, name: true, shopifyDomain: true },
    orderBy: { name: "asc" },
  });

  // Serialize for client component (JSON-safe for Client Component)
  const storeList = stores.map((s) => ({
    id: s.id,
    name: s.name,
    domain: s.shopifyDomain,
  }));
  const initialSelectedStoreId = stores.some((s) => s.id === storeId) ? storeId : null;

  return <MailboxesClient stores={storeList} initialSelectedStoreId={initialSelectedStoreId} />;
}
