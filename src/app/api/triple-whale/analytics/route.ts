import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTripleWhaleAnalytics } from "@/lib/triple-whale/analytics";
import { enqueueMissingTripleWhaleRanges } from "@/lib/triple-whale/backfill";
import {
  type ComparisonMode,
  type DateRange,
  inclusiveDayCount,
} from "@/lib/triple-whale/date-ranges";

const COMPARISON_MODES = new Set<ComparisonMode>([
  "none",
  "previous_period",
  "previous_week",
  "previous_month",
  "previous_quarter",
  "previous_year",
]);

export function parseAnalyticsRequest(params: URLSearchParams): {
  range: DateRange;
  comparison: ComparisonMode;
  shopIds: string[];
} {
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) throw new Error("from and to required");
  const range = { from, to };
  if (inclusiveDayCount(range) > 366) throw new Error("Date range cannot exceed 366 days");
  const comparison = params.get("comparison") ?? "previous_period";
  if (!COMPARISON_MODES.has(comparison as ComparisonMode)) {
    throw new Error("Invalid comparison mode");
  }
  return {
    range,
    comparison: comparison as ComparisonMode,
    shopIds: [...new Set(params.getAll("shopId").filter(Boolean))],
  };
}

export async function GET(request: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  try {
    const parsed = parseAnalyticsRequest(new URL(request.url).searchParams);
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { twTimezone: true },
    });
    const timezone = tenant?.twTimezone ?? "America/Los_Angeles";
    const result = await getTripleWhaleAnalytics({
      tenantId: session.tenantId,
      timezone,
      ...parsed,
    });
    const syncJobs = result.missingRanges.length
      ? await enqueueMissingTripleWhaleRanges({
          tenantId: session.tenantId,
          ranges: result.missingRanges,
        })
      : [];
    return NextResponse.json({
      ...result,
      dataStatus: syncJobs.length ? "syncing" : result.dataStatus,
      syncJobs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid analytics request" },
      { status: 400 },
    );
  }
}
