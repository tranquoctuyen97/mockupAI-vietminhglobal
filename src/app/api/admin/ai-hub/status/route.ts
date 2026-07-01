import { NextResponse } from "next/server";
import { requireAiHubAdmin } from "@/lib/ai-hub/admin-guard";
import { getAiHubRuntimeStatus } from "@/lib/ai-hub/runtime";

export async function GET() {
  const { response } = await requireAiHubAdmin();
  if (response) return response;

  return NextResponse.json(await getAiHubRuntimeStatus());
}
