import { formatInTimeZone } from "date-fns-tz";
import { decrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { fetchSummaryData } from "./client";
import { TripleWhaleRequestGate } from "./request-gate";
import { currentTripleWhaleHour, DEFAULT_TRIPLE_WHALE_TIMEZONE } from "./timezone";
import type { TWDailyRecord } from "./types";

export async function syncStoreRange(input: {
  credentialId: string;
  from: string;
  to: string;
}): Promise<void> {
  const credential = await prisma.tripleWhaleCredential.findUnique({
    where: { id: input.credentialId },
    include: { tenant: true },
  });
  if (!credential) throw new Error(`No Triple Whale credential for ID ${input.credentialId}`);

  const timezone = credential.tenant.twTimezone ?? DEFAULT_TRIPLE_WHALE_TIMEZONE;
  const requestGate = new TripleWhaleRequestGate();
  let records: TWDailyRecord[];
  try {
    records = await fetchSummaryData({
      apiKey: decrypt(credential.apiKeyEncrypted),
      shopDomain: credential.shopDomain,
      startDate: input.from,
      endDate: input.to,
      todayHour: currentTripleWhaleHour(timezone),
      requestGate,
    });
  } finally {
    requestGate.close();
  }

  for (const record of records) {
    if (!record.date) continue;
    // The Prisma column is PostgreSQL DATE; keep the upstream calendar date
    // independent from the tenant timezone used for request boundaries.
    const date = new Date(`${record.date}T00:00:00.000Z`);

    await prisma.tripleWhaleDailyStat.upsert({
      where: { credentialId_date: { credentialId: input.credentialId, date } },
      create: {
        credentialId: input.credentialId,
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
}

export async function syncStore(credentialId: string): Promise<void> {
  const credential = await prisma.tripleWhaleCredential.findUnique({
    where: { id: credentialId },
    include: { tenant: true },
  });
  if (!credential) throw new Error(`No Triple Whale credential for ID ${credentialId}`);

  const timezone = credential.tenant.twTimezone ?? DEFAULT_TRIPLE_WHALE_TIMEZONE;
  const now = new Date();
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const startDate = credential.lastSyncedAt
    ? formatInTimeZone(credential.lastSyncedAt, timezone, "yyyy-MM-dd")
    : formatInTimeZone(credential.syncFromDate, timezone, "yyyy-MM-dd");

  if (startDate > today) return;

  await syncStoreRange({ credentialId, from: startDate, to: today });

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
