import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import DesignsClient from "./DesignsClient";

export const metadata = {
  title: "Designs — MockupAI",
  description: "Thư viện thiết kế POD",
};

/**
 * Designs list — Server Component.
 * Store-first entry point: designs are loaded only after a valid store is selected.
 */
export default async function DesignsPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");

  const { storeId } = await searchParams;
  const limit = 12;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true, shopifyDomain: true },
    orderBy: { name: "asc" },
  });

  const selectedStore = storeId ? (stores.find((store) => store.id === storeId) ?? null) : null;
  const invalidStoreSelected = Boolean(storeId && !selectedStore);

  const designs = selectedStore
    ? await prisma.design.findMany({
        where: { tenantId: session.tenantId, status: "ACTIVE", storeId: selectedStore.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          storeId: true,
          store: { select: { id: true, name: true } },
          previewPath: true,
          width: true,
          height: true,
          dpi: true,
          fileSizeBytes: true,
          mimeType: true,
          createdAt: true,
        },
      })
    : [];

  const total = selectedStore
    ? await prisma.design.count({
        where: { tenantId: session.tenantId, status: "ACTIVE", storeId: selectedStore.id },
      })
    : 0;

  const storage = getStorage();
  const initialDesigns = selectedStore
    ? designs.map((design) => ({
        ...design,
        createdAt: design.createdAt.toISOString(),
        previewUrl: design.previewPath ? storage.getPublicUrl(design.previewPath) : null,
      }))
    : [];
  const initialTotal = selectedStore ? total : 0;

  return (
    <DesignsClient
      initialDesigns={initialDesigns}
      stores={stores.map((store) => ({
        id: store.id,
        name: store.name,
        domain: store.shopifyDomain,
      }))}
      initialStoreId={selectedStore?.id ?? null}
      invalidStoreSelected={invalidStoreSelected}
      initialTotal={initialTotal}
      initialTotalPages={Math.ceil(initialTotal / limit)}
    />
  );
}
