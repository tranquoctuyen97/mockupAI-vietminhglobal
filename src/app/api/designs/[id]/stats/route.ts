/**
 * GET /api/designs/:id/stats — Per-design analytics
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDesignStats } from "@/lib/analytics/queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const stats = await getDesignStats(id);

  if (!stats) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  // Verify tenant access
  if (stats.design.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(stats);
}
