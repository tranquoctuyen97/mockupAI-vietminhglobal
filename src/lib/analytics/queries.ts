/**
 * Analytics aggregate queries
 */

import { prisma } from "@/lib/db";

/**
 * Dashboard summary: designs, listings, orders today, revenue today
 */
export async function getDashboardSummary(tenantId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [designsCount, listingsCount, ordersToday, revenueToday] = await Promise.all([
    prisma.design.count({ where: { tenantId, deletedAt: null } }),
    prisma.listing.count({ where: { tenantId, status: "ACTIVE" } }),
    prisma.order.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
    prisma.order.aggregate({
      where: { tenantId, createdAt: { gte: todayStart } },
      _sum: { totalUsd: true },
    }),
  ]);

  return {
    designs: designsCount,
    listings: listingsCount,
    ordersToday,
    revenueToday: revenueToday._sum.totalUsd || 0,
  };
}

/**
 * Orders by day for chart
 */
export async function getOrdersByDay(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Array<{ date: string; count: number; revenue: number }>> {
  const orders = await prisma.order.findMany({
    where: { tenantId, createdAt: { gte: from, lte: to } },
    select: { createdAt: true, totalUsd: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by date
  const grouped = new Map<string, { count: number; revenue: number }>();

  // Fill all dates
  const current = new Date(from);
  while (current <= to) {
    const key = current.toISOString().slice(0, 10);
    grouped.set(key, { count: 0, revenue: 0 });
    current.setDate(current.getDate() + 1);
  }

  for (const order of orders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const existing = grouped.get(key) || { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += order.totalUsd;
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([date, data]) => ({
    date,
    count: data.count,
    revenue: Math.round(data.revenue * 100) / 100,
  }));
}

/**
 * Top designs by order count
 */
export async function getTopDesigns(tenantId: string, limit = 10) {
  // Get orders with listing → listing has wizardDraftId → draft has designId
  const orders = await prisma.order.findMany({
    where: { tenantId, listingId: { not: null } },
    select: {
      listingId: true,
      totalUsd: true,
    },
  });

  // Group by listingId
  const listingStats = new Map<string, { orders: number; revenue: number }>();
  for (const order of orders) {
    if (!order.listingId) continue;
    const existing = listingStats.get(order.listingId) || { orders: 0, revenue: 0 };
    existing.orders++;
    existing.revenue += order.totalUsd;
    listingStats.set(order.listingId, existing);
  }

  // Get listing details
  const listingIds = Array.from(listingStats.keys());
  if (listingIds.length === 0) return [];

  const listings = await prisma.listing.findMany({
    where: { id: { in: listingIds } },
    select: {
      id: true,
      title: true,
      wizardDraftId: true,
    },
  });

  // Get design info via wizard drafts
  const draftIds = listings.map((l) => l.wizardDraftId).filter(Boolean) as string[];
  const drafts = draftIds.length > 0
    ? await prisma.wizardDraft.findMany({
        where: { id: { in: draftIds } },
        select: { id: true, designId: true },
      })
    : [];

  const designIds = drafts.map((d) => d.designId).filter(Boolean) as string[];
  const designs = designIds.length > 0
    ? await prisma.design.findMany({
        where: { id: { in: designIds } },
        select: { id: true, name: true, previewPath: true },
      })
    : [];

  const designMap = new Map(designs.map((d) => [d.id, d]));
  const draftDesignMap = new Map(drafts.map((d) => [d.id, d.designId]));

  // Build results
  const results = listings.map((listing) => {
    const stats = listingStats.get(listing.id) || { orders: 0, revenue: 0 };
    const designId = listing.wizardDraftId ? draftDesignMap.get(listing.wizardDraftId) : null;
    const design = designId ? designMap.get(designId) : null;

    return {
      listingId: listing.id,
      listingTitle: listing.title,
      designName: design?.name || listing.title,
      previewPath: design?.previewPath || null,
      orderCount: stats.orders,
      revenue: Math.round(stats.revenue * 100) / 100,
    };
  });

  return results
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, limit);
}

/**
 * Per-design stats
 */
export async function getDesignStats(designId: string) {
  const design = await prisma.design.findUnique({
    where: { id: designId },
    select: { id: true, name: true, storagePath: true, previewPath: true, tenantId: true },
  });

  if (!design) return null;

  // Find drafts using this design
  const drafts = await prisma.wizardDraft.findMany({
    where: { designId },
    select: { id: true },
  });

  const draftIds = drafts.map((d) => d.id);

  // Find listings from these drafts
  const listings = draftIds.length > 0
    ? await prisma.listing.findMany({
        where: { wizardDraftId: { in: draftIds } },
        select: { id: true, title: true, status: true, shopifyProductId: true },
      })
    : [];

  const listingIds = listings.map((l) => l.id);

  // Orders for these listings
  const orders = listingIds.length > 0
    ? await prisma.order.findMany({
        where: { listingId: { in: listingIds } },
        select: {
          id: true,
          shopifyOrderNumber: true,
          totalUsd: true,
          customerEmail: true,
          createdAt: true,
          fulfillmentStatus: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    : [];

  const totalOrders = listingIds.length > 0
    ? await prisma.order.count({ where: { listingId: { in: listingIds } } })
    : 0;

  const totalRevenue = listingIds.length > 0
    ? await prisma.order.aggregate({
        where: { listingId: { in: listingIds } },
        _sum: { totalUsd: true },
      })
    : { _sum: { totalUsd: 0 } };

  return {
    design,
    totalOrders,
    totalRevenue: totalRevenue._sum.totalUsd || 0,
    avgOrderValue: totalOrders > 0 ? (totalRevenue._sum.totalUsd || 0) / totalOrders : 0,
    listings,
    recentOrders: orders,
  };
}
