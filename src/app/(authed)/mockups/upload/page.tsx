import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import MockupUploadClient from "./MockupUploadClient";

export const metadata = {
  title: "Upload Mockups - MockupAI",
};

export default async function MockupUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");
  const canUseMockups = await hasFeature(session.tenantId, session.role, "mockup_library");
  if (!canUseMockups) redirect("/dashboard");

  const { storeId } = await searchParams;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true, shopifyDomain: true, printifyShopId: true },
    orderBy: { name: "asc" },
  });

  const validatedStore = stores.find((store) => store.id === storeId) ?? null;
  const initialStoreId = validatedStore?.id ?? null;

  return (
    <MockupUploadClient
      stores={stores.map((store) => ({
        id: store.id,
        name: store.name,
        domain: store.shopifyDomain,
        printifyConnected: Boolean(store.printifyShopId),
      }))}
      initialStoreId={initialStoreId}
    />
  );
}
