import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import UploadDesignClient from "./UploadDesignClient";

export const metadata = {
  title: "Upload Designs - MockupAI",
};

export default async function UploadDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");

  const { storeId } = await searchParams;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const validatedStore = stores.find((store) => store.id === storeId) ?? null;
  const initialStoreId = validatedStore?.id ?? null;

  return <UploadDesignClient stores={stores} initialStoreId={initialStoreId} />;
}
