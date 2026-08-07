import type { Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";

import { type ComparisonMode, comparisonRange, type DateRange } from "./date-ranges";

export type AnalyticsMetricKey =
  | "orderRevenue"
  | "blendedAdSpend"
  | "totalCost"
  | "netProfit"
  | "orders";

export interface AnalyticsShop {
  id: string;
  customName: string;
  shopDomain: string;
}

export interface AnalyticsDailyRow {
  shopId: string;
  date: string;
  orderRevenue: number;
  blendedAdSpend: number;
  totalCost: number;
  netProfit: number;
  orders: number;
}

export interface MissingRange extends DateRange {
  shopId: string;
  scope: "current" | "comparison";
}

export interface MetricSummary {
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  direction: "up" | "down" | "flat" | "none";
  complete: boolean;
}

export interface WorkspaceMetrics {
  designs: number | null;
  activeListings: number | null;
  storeLinked: boolean;
}

export interface TripleWhaleAnalyticsRepository {
  getWorkspaceMetrics(input: {
    tenantId: string;
    shopDomains: string[] | null;
    asOf?: string;
    timezone?: string;
  }): Promise<WorkspaceMetrics>;
  listTenantShops(tenantId: string): Promise<AnalyticsShop[]>;
  listDailyStats(input: {
    tenantId: string;
    shopIds: string[];
    from: string;
    to: string;
    timezone: string;
  }): Promise<AnalyticsDailyRow[]>;
}

export interface TripleWhaleAnalyticsResult {
  dataStatus: "complete" | "partial";
  timezone: string;
  currentRange: DateRange;
  comparisonRange: DateRange | null;
  shops: AnalyticsShop[];
  workspace: WorkspaceMetrics;
  missingRanges: MissingRange[];
  analytics: {
    metrics: Record<AnalyticsMetricKey, MetricSummary>;
    distribution: Record<
      AnalyticsMetricKey,
      Array<{ shopId: string; label: string; value: number }>
    >;
    daily: Record<
      AnalyticsMetricKey,
      Array<{ date: string; current: number; previous: number | null }>
    >;
  };
}

const METRICS: AnalyticsMetricKey[] = [
  "orderRevenue",
  "blendedAdSpend",
  "totalCost",
  "netProfit",
  "orders",
];

function endOfDayInTimezone(date: string, timezone: string): Date {
  return fromZonedTime(`${date}T23:59:59.999`, timezone);
}

function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  const current = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  while (current <= end) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function compactMissingRanges(
  shopId: string,
  dates: string[],
  present: Set<string>,
  scope: MissingRange["scope"],
): MissingRange[] {
  const ranges: MissingRange[] = [];
  let from: string | null = null;
  let to: string | null = null;
  for (const date of dates) {
    if (!present.has(`${shopId}:${date}`)) {
      from ??= date;
      to = date;
    } else if (from && to) {
      ranges.push({ shopId, from, to, scope });
      from = null;
      to = null;
    }
  }
  if (from && to) ranges.push({ shopId, from, to, scope });
  return ranges;
}

function sumMetric(rows: AnalyticsDailyRow[], metric: AnalyticsMetricKey): number {
  return rows.reduce((sum, row) => sum + row[metric], 0);
}

function summarizeMetric(
  currentRows: AnalyticsDailyRow[],
  previousRows: AnalyticsDailyRow[],
  metric: AnalyticsMetricKey,
  currentComplete: boolean,
  previousComplete: boolean,
  hasComparison: boolean,
): MetricSummary {
  const current = currentComplete ? sumMetric(currentRows, metric) : null;
  const previous = hasComparison && previousComplete ? sumMetric(previousRows, metric) : null;
  const complete = currentComplete && (!hasComparison || previousComplete);
  if (current == null || previous == null) {
    return {
      current,
      previous,
      absoluteChange: null,
      percentChange: null,
      direction: "none",
      complete,
    };
  }
  const absoluteChange = current - previous;
  return {
    current,
    previous,
    absoluteChange,
    percentChange: previous === 0 ? null : (absoluteChange / Math.abs(previous)) * 100,
    direction: absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "flat",
    complete,
  };
}

export const prismaTripleWhaleAnalyticsRepository: TripleWhaleAnalyticsRepository = {
  async getWorkspaceMetrics({ tenantId, shopDomains, asOf, timezone }) {
    const asOfDate = asOf && timezone ? endOfDayInTimezone(asOf, timezone) : null;
    const designDateFilter: Prisma.DesignWhereInput = asOfDate
      ? {
          createdAt: { lte: asOfDate },
          OR: [{ deletedAt: null }, { deletedAt: { gt: asOfDate } }],
        }
      : { deletedAt: null };
    const listingDateFilter: Prisma.ListingWhereInput = asOfDate
      ? {
          AND: [
            {
              OR: [
                { publishedAt: { lte: asOfDate } },
                { publishedAt: null, createdAt: { lte: asOfDate }, status: "ACTIVE" },
              ],
            },
            { OR: [{ archivedAt: null }, { archivedAt: { gt: asOfDate } }] },
          ],
        }
      : { status: "ACTIVE" };

    if (shopDomains === null) {
      const [designs, activeListings] = await Promise.all([
        prisma.design.count({ where: { tenantId, ...designDateFilter } }),
        prisma.listing.count({ where: { tenantId, ...listingDateFilter } }),
      ]);
      return { designs, activeListings, storeLinked: true };
    }

    const stores = await prisma.store.findMany({
      where: { tenantId, shopifyDomain: { in: shopDomains } },
      select: { id: true },
    });
    if (stores.length !== shopDomains.length) {
      return { designs: null, activeListings: null, storeLinked: false };
    }

    const storeIds = stores.map((store) => store.id);
    const [designs, activeListings] = await Promise.all([
      prisma.design.count({
        where: { tenantId, storeId: { in: storeIds }, ...designDateFilter },
      }),
      prisma.listing.count({
        where: { tenantId, storeId: { in: storeIds }, ...listingDateFilter },
      }),
    ]);
    return { designs, activeListings, storeLinked: true };
  },
  async listTenantShops(tenantId) {
    return prisma.tripleWhaleCredential.findMany({
      where: { tenantId },
      select: { id: true, customName: true, shopDomain: true },
      orderBy: { customName: "asc" },
    });
  },
  async listDailyStats({ tenantId, shopIds, from, to }) {
    const rows = await prisma.tripleWhaleDailyStat.findMany({
      where: {
        credentialId: { in: shopIds },
        credential: { tenantId },
        date: {
          // `date` is a PostgreSQL DATE. Query it as a calendar date instead
          // of converting it through the dashboard timezone.
          gte: new Date(`${from}T00:00:00.000Z`),
          lte: new Date(`${to}T00:00:00.000Z`),
        },
      },
      orderBy: [{ date: "asc" }, { credentialId: "asc" }],
    });
    return rows.map((row) => ({
      shopId: row.credentialId,
      date: row.date.toISOString().slice(0, 10),
      orderRevenue: Number(row.orderRevenue),
      blendedAdSpend: Number(row.blendedAdSpend),
      totalCost: Number(row.totalCost),
      netProfit: Number(row.netProfit),
      orders: row.orders,
    }));
  },
};

export async function getTripleWhaleAnalytics(
  input: {
    tenantId: string;
    timezone: string;
    range: DateRange;
    comparison: ComparisonMode;
    shopIds: string[];
  },
  repository: TripleWhaleAnalyticsRepository = prismaTripleWhaleAnalyticsRepository,
): Promise<TripleWhaleAnalyticsResult> {
  const tenantShops = await repository.listTenantShops(input.tenantId);
  const tenantShopIds = new Set(tenantShops.map((shop) => shop.id));
  if (input.shopIds.some((shopId) => !tenantShopIds.has(shopId))) {
    throw new Error("Unknown Triple Whale shop");
  }
  const selectedShops = input.shopIds.length
    ? tenantShops.filter((shop) => input.shopIds.includes(shop.id))
    : tenantShops;
  const selectedShopIds = selectedShops.map((shop) => shop.id);
  const workspace = await repository.getWorkspaceMetrics({
    tenantId: input.tenantId,
    shopDomains: input.shopIds.length ? selectedShops.map((shop) => shop.shopDomain) : null,
    asOf: input.range.to,
    timezone: input.timezone,
  });
  const priorRange = comparisonRange(input.range, input.comparison);
  const queryFrom =
    priorRange && priorRange.from < input.range.from ? priorRange.from : input.range.from;
  const queryTo = priorRange && priorRange.to > input.range.to ? priorRange.to : input.range.to;
  const rows = selectedShopIds.length
    ? await repository.listDailyStats({
        tenantId: input.tenantId,
        shopIds: selectedShopIds,
        from: queryFrom,
        to: queryTo,
        timezone: input.timezone,
      })
    : [];
  const currentDates = eachDay(input.range);
  const previousDates = priorRange ? eachDay(priorRange) : [];
  const currentDateSet = new Set(currentDates);
  const previousDateSet = new Set(previousDates);
  const currentRows = rows.filter((row) => currentDateSet.has(row.date));
  const previousRows = rows.filter((row) => previousDateSet.has(row.date));
  const present = new Set(rows.map((row) => `${row.shopId}:${row.date}`));
  const missingRanges = selectedShopIds.flatMap((shopId) => [
    ...compactMissingRanges(shopId, currentDates, present, "current"),
    ...compactMissingRanges(shopId, previousDates, present, "comparison"),
  ]);
  const currentComplete = !missingRanges.some((range) => range.scope === "current");
  const previousComplete = !missingRanges.some((range) => range.scope === "comparison");
  const hasComparison = priorRange != null;

  const metrics = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      summarizeMetric(
        currentRows,
        previousRows,
        metric,
        currentComplete,
        previousComplete,
        hasComparison,
      ),
    ]),
  ) as Record<AnalyticsMetricKey, MetricSummary>;
  const distribution = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      selectedShops.map((shop) => ({
        shopId: shop.id,
        label: shop.customName,
        value: sumMetric(
          currentRows.filter((row) => row.shopId === shop.id),
          metric,
        ),
      })),
    ]),
  ) as TripleWhaleAnalyticsResult["analytics"]["distribution"];
  const daily = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      currentDates.map((date, index) => ({
        date,
        current: sumMetric(
          currentRows.filter((row) => row.date === date),
          metric,
        ),
        previous:
          hasComparison && previousComplete
            ? sumMetric(
                previousRows.filter((row) => row.date === previousDates[index]),
                metric,
              )
            : null,
      })),
    ]),
  ) as TripleWhaleAnalyticsResult["analytics"]["daily"];

  return {
    dataStatus: missingRanges.length ? "partial" : "complete",
    timezone: input.timezone,
    currentRange: input.range,
    comparisonRange: priorRange,
    shops: tenantShops,
    workspace,
    missingRanges,
    analytics: { metrics, distribution, daily },
  };
}
