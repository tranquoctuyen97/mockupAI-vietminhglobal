/**
 * GET /api/listings — List all listings for tenant
 */

import { type NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const requestedPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const requestedLimit = Number.parseInt(searchParams.get("limit") || "20", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20;
  const storeId = searchParams.get("storeId")?.trim();
  const search = searchParams.get("search")?.trim();
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {
    tenantId: session.tenantId,
    archivedAt: null,
  };

  if (status && status !== "all") {
    where.status = status;
  }

  if (storeId) {
    where.storeId = storeId;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { shopifyProductId: { contains: search, mode: "insensitive" } },
      { printifyProductId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        variants: { select: { id: true, colorName: true, colorHex: true } },
        publishJobs: { select: { id: true, stage: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.listing.count({ where }),
  ]);

  return NextResponse.json({ listings, total, page, limit });
}
