import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { decrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { fetchSummaryData } from "./client";

const BACKFILL_DAYS = 90;

export async function syncStore(storeId: string): Promise<void> {
  const credential = await prisma.tripleWhaleCredential.findUnique({
    where: { storeId },
    include: { store: { include: { tenant: true } } },
  });
  if (!credential) throw new Error(`No Triple Whale credential for store ${storeId}`);

  const timezone = credential.store.tenant.twTimezone;
  const now = new Date();
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const startDate = credential.lastSyncedAt
    ? formatInTimeZone(credential.lastSyncedAt, timezone, "yyyy-MM-dd")
    : formatInTimeZone(
        new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000),
        timezone,
        "yyyy-MM-dd",
      );

  if (startDate > today) return;

  const records = await fetchSummaryData({
    apiKey: decrypt(credential.apiKeyEncrypted),
    shopDomain: credential.store.shopifyDomain,
    startDate,
    endDate: today,
  });

  for (const record of records) {
    if (!record.date) continue;
    const date = fromZonedTime(`${record.date}T00:00:00`, timezone);

    await prisma.tripleWhaleDailyStat.upsert({
      where: { storeId_date: { storeId, date } },
      create: {
        storeId,
        date,
        orderRevenue: record.orderRevenue,
        netProfit: record.netProfit,
        netMargin: record.netMargin,
        orders: record.orders,
        paymentGateways: record.paymentGateways,
        shipping: record.shipping,
        blendedAdSpend: record.blendedAdSpend,
        cogs: record.cogs,
        totalCost: record.totalCost,
      },
      update: {
        orderRevenue: record.orderRevenue,
        netProfit: record.netProfit,
        netMargin: record.netMargin,
        orders: record.orders,
        paymentGateways: record.paymentGateways,
        shipping: record.shipping,
        blendedAdSpend: record.blendedAdSpend,
        cogs: record.cogs,
        totalCost: record.totalCost,
        syncedAt: new Date(),
      },
    });
  }

  await prisma.tripleWhaleCredential.update({
    where: { storeId },
    data: { lastSyncedAt: new Date(), syncError: null },
  });
}

export async function syncAllStoresForTenant(tenantId: string): Promise<void> {
  const credentials = await prisma.tripleWhaleCredential.findMany({
    where: { store: { tenantId, deletedAt: null } },
    select: { storeId: true },
  });
  await Promise.allSettled(credentials.map((credential) => syncStore(credential.storeId)));
}

export async function handleSyncError(storeId: string, error: unknown): Promise<void> {
  await prisma.tripleWhaleCredential.update({
    where: { storeId },
    data: { syncError: error instanceof Error ? error.message : String(error) },
  });
}
