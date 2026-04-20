import { NextResponse } from "next/server";
import { getPlacementPresets } from "@/lib/placement/presets";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productType = searchParams.get("productType");
    const tenantId = searchParams.get("tenantId") || "default-tenant"; // For mock/testing until auth is fully integrated for this route

    if (!productType) {
      return NextResponse.json(
        { error: "productType is required" },
        { status: 400 },
      );
    }

    const presets = await getPlacementPresets(tenantId, productType);
    return NextResponse.json({ presets });
  } catch (error) {
    console.error("GET /api/placement/presets error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
