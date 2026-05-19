import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export async function GET() {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const [stores, tenant] = await Promise.all([
    prisma.store.findMany({
      where: { tenantId: session.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        shopifyDomain: true,
        twCredential: {
          select: {
            customName: true,
            encryptionKeyId: true,
            lastSyncedAt: true,
            syncError: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { twTimezone: true },
    }),
  ]);

  return NextResponse.json({
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      shopifyDomain: store.shopifyDomain,
      credential: store.twCredential
        ? {
            customName: store.twCredential.customName,
            apiKeyMasked: `••••••••${store.twCredential.encryptionKeyId.slice(-4)}`,
            lastSyncedAt: store.twCredential.lastSyncedAt,
            syncError: store.twCredential.syncError,
          }
        : null,
    })),
    timezone: tenant?.twTimezone ?? "America/Los_Angeles",
  });
}
