/**
 * GET /api/dashboard/summary — Metric cards data
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDashboardSummary } from "@/lib/analytics/queries";

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await getDashboardSummary(session.tenantId);
  return NextResponse.json(summary);
}
