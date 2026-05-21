import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
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
      date: formatInTimeZone(row.date, timezone, "yyyy-MM-dd"),
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
