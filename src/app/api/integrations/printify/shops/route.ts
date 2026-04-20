/**
 * GET /api/integrations/printify/shops — List available (unlinkable) shops
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getAvailableShops } from "@/lib/printify/account";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const includeLinked = searchParams.get("includeLinked") === "true";

  if (includeLinked) {
    // Return ALL shops for the tenant (admin view: see which store owns which shop)
    const accounts = await prisma.printifyAccount.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const shops = await prisma.printifyShop.findMany({
      where: {
        printifyAccountId: { in: accountIds },
        disconnected: false,
      },
      include: {
        account: { select: { id: true, nickname: true } },
        stores: { select: { id: true, name: true, shopifyDomain: true } },
      },
      orderBy: { title: "asc" },
    });

    return NextResponse.json(shops);
  }

  // Default: only available (unlinked) shops
  const shops = await getAvailableShops(session.tenantId);
  return NextResponse.json(shops);
}
