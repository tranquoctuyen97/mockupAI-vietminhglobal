import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTripleWhaleSyncQueue } from "@/lib/queue/queue";

export async function POST() {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const credentials = await prisma.tripleWhaleCredential.findMany({
    where: { store: { tenantId: session.tenantId, deletedAt: null } },
    select: { storeId: true },
  });
  const queue = getTripleWhaleSyncQueue();

  await Promise.all(
    credentials.map((credential) =>
      queue.add(
        "sync-store",
        { storeId: credential.storeId, tenantId: session.tenantId },
        { jobId: `tw-sync-${credential.storeId}-${Date.now()}` },
      ),
    ),
  );

  return NextResponse.json({ success: true, queued: credentials.length });
}
