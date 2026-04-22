import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { listStores } from "@/lib/stores/store-service";
import StoresClient from "./StoresClient";

export const metadata = {
  title: "Stores — MockupAI",
  description: "Quản lý kết nối Shopify + Printify",
};

/**
 * Stores list — Server Component.
 * Fetches stores and user role on the server.
 */
export default async function StoresPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const stores = await listStores(session.tenantId);

  // Serialize Date fields for client
  const serialized = stores.map((s: Record<string, unknown>) => ({
    ...s,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    lastHealthCheck: s.lastHealthCheck instanceof Date ? s.lastHealthCheck.toISOString() : s.lastHealthCheck,
  }));

  return <StoresClient initialStores={serialized as never[]} userRole={session.role} />;
}
