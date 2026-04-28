import { NextResponse } from "next/server";
import { PLACEMENT_PRESETS } from "@/lib/placement/presets";

export async function GET() {
  return NextResponse.json({ presets: PLACEMENT_PRESETS });
}
