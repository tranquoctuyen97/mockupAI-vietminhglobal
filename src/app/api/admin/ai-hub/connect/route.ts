import { NextResponse } from "next/server";
import { requireAiHubAdmin } from "@/lib/ai-hub/admin-guard";
import { startCodexDeviceAuth } from "@/lib/ai-hub/runtime";

export async function POST() {
  const { response } = await requireAiHubAdmin();
  if (response) return response;

  const result = await startCodexDeviceAuth();
  return NextResponse.json(result);
}
