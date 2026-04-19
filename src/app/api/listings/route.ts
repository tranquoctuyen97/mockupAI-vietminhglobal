/**
 * GET /api/listings — List all listings for tenant
 */

import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {
    tenantId: session.tenantId,
    archivedAt: null,
  };

  if (status && status !== "all") {
    where.status = status;
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
