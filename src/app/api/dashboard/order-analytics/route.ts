import { fromZonedTime } from "date-fns-tz";
import { NextResponse } from "next/server";
import {
  type DashboardOrderAnalytics,
  getDashboardOrderAnalytics,
} from "@/lib/analytics/dashboard-orders";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { type DateRange, inclusiveDayCount } from "@/lib/triple-whale/date-ranges";
import { DEFAULT_TRIPLE_WHALE_TIMEZONE } from "@/lib/triple-whale/timezone";

const MAX_RANGE_DAYS = 366;

export interface DashboardOrderAnalyticsRequest {
  from: string;
  to: string;
  shopId: string | null;
  timezone: string;
}

export function parseDashboardOrderAnalyticsRequest(
  params: URLSearchParams,
): DashboardOrderAnalyticsRequest {
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) throw new Error("from and to required");

  const range: DateRange = { from, to };
  if (inclusiveDayCount(range) > MAX_RANGE_DAYS) {
    throw new Error(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  return {
    from,
    to,
    shopId: params.get("shopId") || null,
    timezone: params.get("timezone") || "UTC",
  };
}

export async function GET(request: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  try {
    const parsed = parseDashboardOrderAnalyticsRequest(new URL(request.url).searchParams);
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { twTimezone: true },
    });
    const timezone = tenant?.twTimezone ?? DEFAULT_TRIPLE_WHALE_TIMEZONE;

    let storeIds: string[] | null = null;
    let shopMapped = true;
    if (parsed.shopId) {
      const credential = await prisma.tripleWhaleCredential.findFirst({
        where: { id: parsed.shopId, tenantId: session.tenantId },
        select: { shopDomain: true },
      });
      if (!credential) {
        return NextResponse.json({ error: "Unknown Triple Whale shop" }, { status: 400 });
      }

      const store = await prisma.store.findFirst({
        where: {
          tenantId: session.tenantId,
          shopifyDomain: credential.shopDomain,
          deletedAt: null,
        },
        select: { id: true },
      });
      storeIds = store ? [store.id] : [];
      shopMapped = Boolean(store);
    }

    const from = fromZonedTime(`${parsed.from}T00:00:00`, timezone);
    const localEnd = fromZonedTime(`${parsed.to}T23:59:59.999`, timezone);
    const toExclusive = new Date(localEnd.getTime() + 1);
    const stats = await getDashboardOrderAnalytics({
      tenantId: session.tenantId,
      storeIds,
      from,
      toExclusive,
      fromDate: parsed.from,
      toDate: parsed.to,
      timezone,
    });

    return NextResponse.json({
      from: parsed.from,
      to: parsed.to,
      shopId: parsed.shopId,
      shopMapped,
      stats,
    } satisfies {
      from: string;
      to: string;
      shopId: string | null;
      shopMapped: boolean;
      stats: DashboardOrderAnalytics;
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid dashboard order analytics request",
      },
      { status: 400 },
    );
  }
}
