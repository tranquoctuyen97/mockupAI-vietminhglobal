/**
 * GET /api/dashboard/top-designs?limit=10
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getTopDesigns } from "@/lib/analytics/queries";

export async function GET(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);

  const data = await getTopDesigns(session.tenantId, limit);
  return NextResponse.json(data);
}
