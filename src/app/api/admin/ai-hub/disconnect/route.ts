import { NextResponse } from "next/server";
import { requireAiHubAdmin } from "@/lib/ai-hub/admin-guard";
import { logoutCodex } from "@/lib/ai-hub/runtime";

export async function POST() {
  const { response } = await requireAiHubAdmin();
  if (response) return response;

  const result = await logoutCodex();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
