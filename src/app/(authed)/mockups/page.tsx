import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { storageUrl } from "@/lib/mockup/custom-library";
import MockupsClient from "./MockupsClient";

export const metadata = {
  title: "Mockups - MockupAI",
};

type MockupCompositeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  imageWidth: number;
  imageHeight: number;
};

/**
 * Mockups list — Server Component.
 * Store-first entry point: mockups are loaded only after a valid store is selected.
 */
export default async function MockupsPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");
  const canUseMockups = await hasFeature(session.tenantId, session.role, "mockup_library");
  if (!canUseMockups) redirect("/dashboard");

  const { storeId } = await searchParams;
  const limit = 12;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true, shopifyDomain: true },
    orderBy: { name: "asc" },
  });

  const selectedStore = storeId ? (stores.find((store) => store.id === storeId) ?? null) : null;
  const invalidStoreSelected = Boolean(storeId && !selectedStore);

  const mockups = selectedStore
    ? await prisma.mockupLibraryItem.findMany({
        where: {
          tenantId: session.tenantId,
          isActive: true,
          deletedAt: null,
          storeId: selectedStore.id,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: limit,
        include: { _count: { select: { templateItems: true } } },
      })
    : [];

  const total = selectedStore
    ? await prisma.mockupLibraryItem.count({
        where: {
          tenantId: session.tenantId,
          isActive: true,
          deletedAt: null,
          storeId: selectedStore.id,
        },
      })
    : 0;

  const initialMockups = selectedStore
    ? mockups.map((m) => ({
        id: m.id,
        name: m.name,
        imageUrl: storageUrl(m.storagePath),
        width: m.width,
        height: m.height,
        view: m.view,
        sceneType: m.sceneType,
        compositeRegionPx: m.compositeRegionPx as MockupCompositeRegion | null,
        templateAttachmentCount: m._count.templateItems,
      }))
    : [];
  const initialTotal = selectedStore ? total : 0;

  return (
    <MockupsClient
      initialMockups={initialMockups}
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
