import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export interface ListingOrderDay {
  listingId: string;
  date: string;
  count: number;
}

export interface ListingOrderStats {
  orderCount: number;
  daily: Array<{ date: string; count: number }>;
}

interface ListingOrderRow {
  listingId: string;
  date: Date;
  count: number;
}

export async function getListingOrderStats(
  tenantId: string,
  listingIds: string[],
  from: Date,
  toExclusive: Date,
): Promise<Record<string, ListingOrderStats>> {
  const stats: Record<string, ListingOrderStats> = {};
  for (const listingId of listingIds) {
    stats[listingId] = { orderCount: 0, daily: [] };
  }

  if (listingIds.length === 0) return stats;

  const rows = await prisma.$queryRaw<ListingOrderRow[]>(Prisma.sql`
    SELECT
      oli.listing_id AS "listingId",
      DATE_TRUNC('day', o.created_at)::date AS "date",
      COUNT(DISTINCT oli.order_id)::int AS "count"
    FROM order_line_items oli
    INNER JOIN orders o ON o.id = oli.order_id
    INNER JOIN listings l ON l.id = oli.listing_id
    WHERE l.tenant_id = ${tenantId}
      AND l.archived_at IS NULL
      AND oli.listing_id IN (${Prisma.join(listingIds)})
      AND o.created_at >= ${from}
      AND o.created_at < ${toExclusive}
    GROUP BY oli.listing_id, DATE_TRUNC('day', o.created_at)::date
    ORDER BY DATE_TRUNC('day', o.created_at)::date ASC
  `);

  for (const row of rows) {
    if (!stats[row.listingId]) continue;

    const date =
      row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10);
    const count = Number(row.count);
    stats[row.listingId].daily.push({ date, count });
    stats[row.listingId].orderCount += count;
  }

  return stats;
}
