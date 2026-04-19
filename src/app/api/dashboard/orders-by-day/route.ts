/**
 * GET /api/dashboard/orders-by-day?from=2026-04-01&to=2026-04-19
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getOrdersByDay } from "@/lib/analytics/queries";

export async function GET(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const now = new Date();
  const fromDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : now;

  const data = await getOrdersByDay(session.tenantId, fromDate, toDate);
  return NextResponse.json(data);
}
