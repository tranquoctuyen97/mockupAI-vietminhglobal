import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { decrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { fetchSummaryData } from "./client";

export async function syncStore(credentialId: string): Promise<void> {
  const credential = await prisma.tripleWhaleCredential.findUnique({
    where: { id: credentialId },
    include: { tenant: true },
  });
  if (!credential) throw new Error(`No Triple Whale credential for ID ${credentialId}`);

  const timezone = credential.tenant.twTimezone ?? "America/Los_Angeles";
  const now = new Date();
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const startDate = credential.lastSyncedAt
    ? formatInTimeZone(credential.lastSyncedAt, timezone, "yyyy-MM-dd")
    : formatInTimeZone(credential.syncFromDate, timezone, "yyyy-MM-dd");

  if (startDate > today) return;

  const todayHour = Number(formatInTimeZone(now, timezone, "H"));

  const records = await fetchSummaryData({
    apiKey: decrypt(credential.apiKeyEncrypted),
    shopDomain: credential.shopDomain,
    startDate,
    endDate: today,
    todayHour,
  });

  for (const record of records) {
    if (!record.date) continue;
    const date = fromZonedTime(`${record.date}T00:00:00`, timezone);

    await prisma.tripleWhaleDailyStat.upsert({
      where: { credentialId_date: { credentialId, date } },
      create: {
        credentialId,
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
    where: { id: credentialId },
    data: { lastSyncedAt: new Date(), syncError: null },
  });
}

export async function syncAllStoresForTenant(tenantId: string): Promise<void> {
  const credentials = await prisma.tripleWhaleCredential.findMany({
    where: { tenantId },
    select: { id: true },
  });
  await Promise.allSettled(credentials.map((credential) => syncStore(credential.id)));
}

export async function handleSyncError(credentialId: string, error: unknown): Promise<void> {
  await prisma.tripleWhaleCredential.update({
    where: { id: credentialId },
    data: { syncError: error instanceof Error ? error.message : String(error) },
  });
}
