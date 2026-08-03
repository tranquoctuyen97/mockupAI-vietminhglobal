import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/auth/guards";
import { getBackfillJobSummaries } from "@/lib/triple-whale/backfill";

export async function GET(request: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const jobIds = [...new Set(new URL(request.url).searchParams.getAll("jobId").filter(Boolean))];
  if (!jobIds.length) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  const jobs = await getBackfillJobSummaries(jobIds, session.tenantId);
  return NextResponse.json({ jobs });
}
