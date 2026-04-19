/**
 * GET /api/designs?q=&page=1&limit=20
 * List designs with search and pagination
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";

export async function GET(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const where = {
    tenantId: session.tenantId,
    status: "ACTIVE" as const,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [designs, total] = await Promise.all([
    prisma.design.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
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
    prisma.design.count({ where }),
  ]);

  const storage = getStorage();

  return NextResponse.json({
    designs: designs.map((d) => ({
      ...d,
      previewUrl: d.previewPath ? storage.getPublicUrl(d.previewPath) : null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
