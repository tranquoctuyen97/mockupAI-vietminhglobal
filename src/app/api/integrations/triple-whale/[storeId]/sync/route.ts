import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTripleWhaleSyncQueue } from "@/lib/queue/queue";

export async function POST(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { storeId } = await params;
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, deletedAt: null },
    include: { twCredential: true },
  });
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  if (!store.twCredential) {
    return NextResponse.json({ error: "No Triple Whale credential" }, { status: 400 });
  }

  await getTripleWhaleSyncQueue().add(
    "sync-store",
    { storeId, tenantId: session.tenantId },
    { jobId: `tw-sync-${storeId}-${Date.now()}` },
  );

  return NextResponse.json({ success: true, queued: true });
}
