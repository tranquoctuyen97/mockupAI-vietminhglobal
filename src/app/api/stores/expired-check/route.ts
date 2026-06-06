/**
 * GET /api/stores/expired-check
 *
 * Lightweight endpoint for TokenExpiredBanner.
 * Returns only stores with TOKEN_EXPIRED status — 1 DB query
 * instead of the full listStores() call (7 + N queries).
 */
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "TOKEN_EXPIRED" },
    select: { id: true, name: true, shopifyDomain: true },
  });

  return Response.json({ expired }, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
