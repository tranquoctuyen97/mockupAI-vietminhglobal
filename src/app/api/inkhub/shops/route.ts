import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/auth/guards";
import { fetchInkhubShopStats } from "@/lib/inkhub/orders-client";

/** GET /api/inkhub/shops — shop ids available for Store → Inkhub mapping. */
export async function GET() {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  try {
    return NextResponse.json(await fetchInkhubShopStats(session.tenantId));
  } catch (error) {
    console.error("[Inkhub shops] Failed to load shop stats:", error);
    return NextResponse.json({ error: "Unable to load Inkhub shops" }, { status: 502 });
  }
}
