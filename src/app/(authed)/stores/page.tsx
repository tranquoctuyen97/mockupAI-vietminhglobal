import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { listStores } from "@/lib/stores/store-service";
import StoresClient from "./StoresClient";

export const metadata = {
  title: "Stores — MockupAI",
  description: "Quản lý kết nối Shopify + Printify",
};

export default async function StoresPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const stores = await listStores(session.tenantId);
  const canManageStores = await hasFeature(session.tenantId, session.role, "stores");

  // Serialize Date fields for client
  const serialized = stores.map((s: Record<string, unknown>) => ({
    ...s,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    lastHealthCheck: s.lastHealthCheck instanceof Date ? s.lastHealthCheck.toISOString() : s.lastHealthCheck,
  }));

  return <StoresClient initialStores={serialized as never[]} userRole={session.role} canManageStores={canManageStores} />;
}
