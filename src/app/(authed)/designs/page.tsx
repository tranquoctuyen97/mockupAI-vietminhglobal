import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import DesignsClient from "./DesignsClient";

export const metadata = {
  title: "Designs — MockupAI",
  description: "Thư viện thiết kế POD",
};

/**
 * Designs list — Server Component.
 * Fetches initial page of designs on server for instant load.
 */
export default async function DesignsPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const limit = 20;

  const [designs, total] = await Promise.all([
    prisma.design.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        name: true,
        previewPath: true,
        width: true,
        height: true,
        dpi: true,
        fileSizeBytes: true,
        mimeType: true,
        createdAt: true,
      },
    }),
    prisma.design.count({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
    }),
  ]);

  const storage = getStorage();
  const initialDesigns = designs.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
    previewUrl: d.previewPath ? storage.getPublicUrl(d.previewPath) : null,
  }));

  return (
    <DesignsClient
      initialDesigns={initialDesigns}
      initialTotal={total}
      initialTotalPages={Math.ceil(total / limit)}
    />
  );
}
