import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export interface DashboardOrderRow {
  date: string | Date;
  orderCount: number;
  actualTotalCost: unknown;
  actualCostOrderCount: number;
  pendingCostOrderCount: number;
}

export interface DashboardOrderDailyPoint {
  date: string;
  count: number;
  actualTotalCost: number | null;
  actualCostOrderCount: number;
  pendingCostOrderCount: number;
}

export interface DashboardOrderAnalytics {
  orderCount: number;
  actualTotalCost: number | null;
  actualCostOrderCount: number;
  pendingCostOrderCount: number;
  daily: DashboardOrderDailyPoint[];
}

function dateKey(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function numberOrNull(value: unknown): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function summarizeDashboardOrderRows(
  rows: DashboardOrderRow[],
  from: string,
  to: string,
): DashboardOrderAnalytics {
  const rowsByDate = new Map(rows.map((row) => [dateKey(row.date), row]));
  const daily = eachDate(from, to).map((date) => {
    const row = rowsByDate.get(date);
    const actualTotalCost = numberOrNull(row?.actualTotalCost ?? null);
    return {
      date,
      count: Number(row?.orderCount ?? 0),
      actualTotalCost,
      actualCostOrderCount: Number(row?.actualCostOrderCount ?? 0),
      pendingCostOrderCount: Number(row?.pendingCostOrderCount ?? 0),
    };
  });

  const actualCostOrderCount = daily.reduce((sum, row) => sum + row.actualCostOrderCount, 0);
  const pendingCostOrderCount = daily.reduce((sum, row) => sum + row.pendingCostOrderCount, 0);
  const actualTotalCost = daily.reduce(
    (sum, row) => (row.actualTotalCost === null ? sum : sum + row.actualTotalCost),
    0,
  );

  return {
    orderCount: daily.reduce((sum, row) => sum + row.count, 0),
    actualTotalCost: actualCostOrderCount > 0 ? actualTotalCost : null,
    actualCostOrderCount,
    pendingCostOrderCount,
    daily,
  };
}

interface DashboardOrderDbRow {
  date: Date;
  orderCount: number;
  actualTotalCost: unknown;
  actualCostOrderCount: number;
  pendingCostOrderCount: number;
}

export interface GetDashboardOrderAnalyticsInput {
  tenantId: string;
  storeIds: string[] | null;
  from: Date;
  toExclusive: Date;
  fromDate: string;
  toDate: string;
  timezone: string;
}

export async function getDashboardOrderAnalytics(
  input: GetDashboardOrderAnalyticsInput,
): Promise<DashboardOrderAnalytics> {
  if (input.storeIds?.length === 0) {
    return summarizeDashboardOrderRows([], input.fromDate, input.toDate);
  }

  const filters = [
    Prisma.sql`o.tenant_id = ${input.tenantId}`,
    Prisma.sql`o.created_at >= ${input.from}`,
    Prisma.sql`o.created_at < ${input.toExclusive}`,
  ];
  const listingFilters = [
    Prisma.sql`oli.order_id = o.id`,
    Prisma.sql`l.tenant_id = ${input.tenantId}`,
    Prisma.sql`l.archived_at IS NULL`,
  ];
  if (input.storeIds) {
    listingFilters.push(Prisma.sql`l.store_id IN (${Prisma.join(input.storeIds)})`);
  }

  const rows = await prisma.$queryRaw<DashboardOrderDbRow[]>(Prisma.sql`
    SELECT
      DATE_TRUNC('day', o.created_at AT TIME ZONE ${input.timezone})::date AS "date",
      COUNT(DISTINCT o.id)::int AS "orderCount",
      SUM(
        CASE
          WHEN o.actual_cost_status = 'READY' AND o.actual_total_cost IS NOT NULL
            THEN o.actual_total_cost
          ELSE 0
        END
      ) AS "actualTotalCost",
      COUNT(*) FILTER (
        WHERE o.actual_cost_status = 'READY' AND o.actual_total_cost IS NOT NULL
      )::int AS "actualCostOrderCount",
      COUNT(*) FILTER (
        WHERE o.actual_cost_status IS DISTINCT FROM 'READY' OR o.actual_total_cost IS NULL
      )::int AS "pendingCostOrderCount"
    FROM orders o
    WHERE ${Prisma.join(filters, " AND ")}
      AND EXISTS (
        SELECT 1
        FROM order_line_items oli
        INNER JOIN listings l ON l.id = COALESCE(oli.listing_id, o.listing_id)
        WHERE ${Prisma.join(listingFilters, " AND ")}
      )
    GROUP BY DATE_TRUNC('day', o.created_at AT TIME ZONE ${input.timezone})::date
    ORDER BY DATE_TRUNC('day', o.created_at AT TIME ZONE ${input.timezone})::date ASC
  `);

  return summarizeDashboardOrderRows(rows, input.fromDate, input.toDate);
}
