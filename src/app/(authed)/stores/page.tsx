import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { listStores } from "@/lib/stores/store-service";
import StoresClient from "./StoresClient";

export const metadata = {
  title: "Stores — MockupAI",
  description: "Quản lý kết nối Shopify + Printify",
};

export default async function StoresPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const [stores, canManageStores] = await Promise.all([
    listStores(session.tenantId),
    hasFeature(session.tenantId, session.role, "stores"),
  ]);

  // Serialize Date fields for client
  // biome-ignore lint: listStores returns Prisma objects with Date fields that need ISO string conversion
  const serialized = (stores as any[]).map((s) => ({
    ...s,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    lastHealthCheck:
      s.lastHealthCheck instanceof Date ? s.lastHealthCheck.toISOString() : s.lastHealthCheck,
  }));

  return (
    <StoresClient
      initialStores={serialized}
      canManageStores={canManageStores}
    />
  );
}
