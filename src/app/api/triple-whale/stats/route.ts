import { fromZonedTime } from "date-fns-tz";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { twTimezone: true },
  });
  const timezone = tenant?.twTimezone ?? "America/Los_Angeles";
  const fromUtc = fromZonedTime(`${from}T00:00:00`, timezone);
  const toUtc = fromZonedTime(`${to}T23:59:59`, timezone);

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, deletedAt: null },
    select: {
      id: true,
      shopifyDomain: true,
      twCredential: { select: { customName: true } },
      twDailyStats: {
        where: { date: { gte: fromUtc, lte: toUtc } },
        select: {
          orderRevenue: true,
          netProfit: true,
          orders: true,
          paymentGateways: true,
          shipping: true,
          blendedAdSpend: true,
          cogs: true,
          totalCost: true,
        },
      },
    },
  });

  const perStore = stores
    .filter((store) => store.twCredential && store.twDailyStats.length > 0)
    .map((store) => {
      const agg = store.twDailyStats.reduce(
        (acc, dailyStat) => ({
          orderRevenue: acc.orderRevenue + Number(dailyStat.orderRevenue),
          netProfit: acc.netProfit + Number(dailyStat.netProfit),
          orders: acc.orders + dailyStat.orders,
          paymentGateways: acc.paymentGateways + Number(dailyStat.paymentGateways),
          shipping: acc.shipping + Number(dailyStat.shipping),
          blendedAdSpend: acc.blendedAdSpend + Number(dailyStat.blendedAdSpend),
          cogs: acc.cogs + Number(dailyStat.cogs),
          totalCost: acc.totalCost + Number(dailyStat.totalCost),
        }),
        {
          orderRevenue: 0,
          netProfit: 0,
          orders: 0,
          paymentGateways: 0,
          shipping: 0,
          blendedAdSpend: 0,
          cogs: 0,
          totalCost: 0,
        },
      );

      return {
        storeId: store.id,
        shopifyDomain: store.shopifyDomain,
        customName: store.twCredential?.customName ?? store.shopifyDomain,
        ...agg,
        netMargin: agg.orderRevenue > 0 ? agg.netProfit / agg.orderRevenue : 0,
      };
    });

  const totals = perStore.reduce(
    (acc, store) => ({
      orderRevenue: acc.orderRevenue + store.orderRevenue,
      netProfit: acc.netProfit + store.netProfit,
      orders: acc.orders + store.orders,
      paymentGateways: acc.paymentGateways + store.paymentGateways,
      shipping: acc.shipping + store.shipping,
      blendedAdSpend: acc.blendedAdSpend + store.blendedAdSpend,
      cogs: acc.cogs + store.cogs,
      totalCost: acc.totalCost + store.totalCost,
    }),
    {
      orderRevenue: 0,
      netProfit: 0,
      orders: 0,
      paymentGateways: 0,
      shipping: 0,
      blendedAdSpend: 0,
      cogs: 0,
      totalCost: 0,
    },
  );

  return NextResponse.json({ perStore, totals, timezone });
}
