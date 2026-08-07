import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { calendarDateToUtcMidnight } from "@/lib/triple-whale/date-ranges";
import { DEFAULT_TRIPLE_WHALE_TIMEZONE } from "@/lib/triple-whale/timezone";

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
  const timezone = tenant?.twTimezone ?? DEFAULT_TRIPLE_WHALE_TIMEZONE;
  const fromUtc = calendarDateToUtcMidnight(from);
  const toUtc = calendarDateToUtcMidnight(to);

  const rows = await prisma.tripleWhaleDailyStat.findMany({
    where: {
      date: { gte: fromUtc, lte: toUtc },
      credential: { tenantId: session.tenantId },
    },
    include: {
      credential: {
        select: {
          shopDomain: true,
          customName: true,
        },
      },
    },
    orderBy: [{ date: "desc" }, { credentialId: "asc" }],
    take: 500,
  });

  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      shopDomain: row.credential.shopDomain,
      customName: row.credential.customName,
      orderRevenue: Number(row.orderRevenue),
      netProfit: Number(row.netProfit),
      netMargin: Number(row.netMargin),
      orders: row.orders,
      paymentGateways: Number(row.paymentGateways),
      shipping: Number(row.shipping),
      blendedAdSpend: Number(row.blendedAdSpend),
      cogs: Number(row.cogs),
      totalCost: Number(row.totalCost),
    })),
    timezone,
  });
}
