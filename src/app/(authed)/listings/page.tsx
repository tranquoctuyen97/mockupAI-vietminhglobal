import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import ListingsClient from "./ListingsClient";

export const metadata = {
  title: "Listings — MockupAI",
  description: "Quản lý sản phẩm đã publish",
};

/**
 * Listings — Server Component.
 * Fetches initial listings for instant SSR render.
 */
export default async function ListingsPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where: { tenantId: session.tenantId, archivedAt: null },
      include: {
        variants: { select: { id: true, colorName: true, colorHex: true } },
        publishJobs: { select: { id: true, stage: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.listing.count({
      where: { tenantId: session.tenantId, archivedAt: null },
    }),
  ]);

  // Serialize dates for client
  const serialized = listings.map((l) => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
    archivedAt: l.archivedAt?.toISOString() ?? null,
  }));

  return <ListingsClient initialListings={serialized} initialTotal={total} />;
}
