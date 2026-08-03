import { prisma } from "@/lib/db";
import { type InkhubOrderItem, normalizeInkhubOrderCosts } from "@/lib/inkhub/costs";
import { fetchInkhubOrdersPage } from "@/lib/inkhub/orders-client";

const RECENT_SYNC_DAYS = 31;
const RECENT_SORT_BUFFER_DAYS = 3;

export type InkhubSyncMode = "initial" | "recent";

export type InkhubSyncInput = {
  tenantId: string;
  storeId: string;
  shopId: number;
  mode: InkhubSyncMode;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function date(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function money(cents: number | null): string | null {
  return cents === null ? null : (cents / 100).toFixed(2);
}

function addressEmail(order: JsonRecord): string | null {
  return text(record(order.addressTo).email) ?? text(order.customerEmail);
}

function statusForFulfillment(status: string | null): "UNFULFILLED" | "FULFILLED" | "PARTIAL" {
  const normalized = String(status ?? "").toLowerCase();
  if (["fulfilled", "shipped", "delivered", "complete", "completed"].includes(normalized)) {
    return "FULFILLED";
  }
  if (
    ["printing", "in-production", "partially-fulfilled", "partial", "ready-to-ship"].includes(
      normalized,
    )
  ) {
    return "PARTIAL";
  }
  return "UNFULFILLED";
}

function printifyProductId(item: InkhubOrderItem): string | null {
  return text(item.productId);
}

function printifyVariantId(item: InkhubOrderItem): string | null {
  return text(item.variantId);
}

async function findListingMatch(tenantId: string, storeId: string, item: InkhubOrderItem) {
  const productId = printifyProductId(item);
  const variantId = printifyVariantId(item);
  const sku = text(item.SKU ?? item.sku);

  if (variantId) {
    const variant = await prisma.listingVariant.findFirst({
      where: {
        printifyVariantId: variantId,
        listing: { tenantId, storeId },
      },
      select: { id: true, listingId: true },
    });
    if (variant) return variant;
  }

  if (productId) {
    const listing = await prisma.listing.findFirst({
      where: { tenantId, storeId, printifyProductId: productId },
      select: { id: true },
    });
    if (listing) return { id: null, listingId: listing.id };
  }

  if (sku) {
    const variant = await prisma.listingVariant.findFirst({
      where: {
        sku,
        listing: { tenantId, storeId },
      },
      select: { id: true, listingId: true },
    });
    if (variant) return variant;
  }

  return { id: null, listingId: null };
}

function itemTitle(item: InkhubOrderItem): string {
  const raw = record(item);
  return text(raw.itemName) ?? text(raw.title) ?? text(item.SKU ?? item.sku) ?? "Inkhub item";
}

function asOrderItems(order: JsonRecord): InkhubOrderItem[] {
  return Array.isArray(order.items) ? (order.items as InkhubOrderItem[]) : [];
}

function withinRecentWindow(order: JsonRecord, cutoff: Date): boolean {
  const createdAt = date(order.createdAt);
  const updatedAt = date(order.updatedAt);
  return Boolean((createdAt && createdAt >= cutoff) || (updatedAt && updatedAt >= cutoff));
}

function canStopRecentPage(items: JsonRecord[], cutoff: Date): boolean {
  if (items.length === 0) return true;
  const bufferedCutoff = new Date(cutoff.getTime() - RECENT_SORT_BUFFER_DAYS * 24 * 60 * 60 * 1000);
  const printifyDates = items.map((item) => date(item.printifyCreated));
  return printifyDates.every((value) => value !== null && value < bufferedCutoff);
}

async function upsertOrder(
  tenantId: string,
  storeId: string,
  shopId: number,
  rawOrder: JsonRecord,
) {
  const inkhubOrderId = integer(rawOrder.id);
  if (inkhubOrderId === null) throw new Error("Inkhub order is missing a numeric id");

  const shopifyOrderId = text(rawOrder.shopifyId);
  const code = text(rawOrder.code) ?? text(rawOrder.shopOrderLabel);
  const inkhubCreatedAt = date(rawOrder.createdAt) ?? date(rawOrder.printifyCreated);
  const inkhubUpdatedAt = date(rawOrder.updatedAt);
  const inkhubStatus = text(rawOrder.status) ?? text(rawOrder.printifyStatus);
  const costs = normalizeInkhubOrderCosts(rawOrder);
  const rawItems = asOrderItems(rawOrder);
  const lineMatches = await Promise.all(
    rawItems.map((item) => findListingMatch(tenantId, storeId, item)),
  );

  const existingByShopify = shopifyOrderId
    ? await prisma.order.findFirst({ where: { shopifyOrderId } })
    : null;
  const existing =
    existingByShopify ??
    (await prisma.order.findFirst({
      where: { tenantId, storeId, inkhubShopId: shopId, inkhubOrderId },
    }));

  const lineData = rawItems.map((item, index) => {
    const match = lineMatches[index];
    const normalized = costs.lines[index];
    const quantity = Math.max(1, integer(item.quantity) ?? 1);
    const raw = record(item);
    const priceUsd = Number(raw.priceUsd ?? raw.price ?? raw.unitPrice ?? 0);
    return {
      listingId: match.listingId,
      listingVariantId: match.id,
      inkhubItemId: integer(item.id),
      inkhubProductId: printifyProductId(item),
      inkhubVariantId: printifyVariantId(item),
      sku: text(item.SKU ?? item.sku),
      title: itemTitle(item),
      quantity,
      priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
      actualFulfillmentCost: money(normalized?.fulfillmentCents ?? null),
      actualShippingCost: money(normalized?.shippingCents ?? null),
      actualTaxCost: money(normalized?.taxCents ?? null),
      actualOtherCost: money(normalized?.otherCents ?? null),
      actualTotalCost: money(normalized?.totalCents ?? null),
      actualCostStatus: normalized?.status ?? "PENDING",
    };
  });

  const baseData = {
    tenantId,
    storeId,
    listingId:
      lineMatches.find((match) => match.listingId)?.listingId ?? existing?.listingId ?? null,
    shopifyOrderId,
    shopifyOrderNumber: existing?.shopifyOrderNumber ?? code,
    customerEmail: addressEmail(rawOrder) ?? existing?.customerEmail ?? null,
    totalUsd: existing?.totalUsd ?? 0,
    currency: existing?.currency ?? "USD",
    fulfillmentStatus: statusForFulfillment(inkhubStatus),
    printifyOrderId: text(rawOrder.printifyId) ?? existing?.printifyOrderId ?? null,
    printifyStatus: text(rawOrder.printifyStatus) ?? existing?.printifyStatus ?? null,
    inkhubOrderId,
    inkhubShopId: shopId,
    inkhubCode: code ?? existing?.inkhubCode ?? null,
    inkhubCreatedAt: inkhubCreatedAt ?? existing?.inkhubCreatedAt ?? null,
    inkhubUpdatedAt: inkhubUpdatedAt ?? existing?.inkhubUpdatedAt ?? null,
    inkhubSyncedAt: new Date(),
    inkhubStatus: inkhubStatus ?? existing?.inkhubStatus ?? null,
    actualFulfillmentCost: money(costs.fulfillmentCents),
    actualShippingCost: money(costs.shippingCents),
    actualTaxCost: money(costs.taxCents),
    actualOtherCost: money(costs.otherCents),
    actualTotalCost: money(costs.totalCents),
    actualCostStatus: costs.status,
  };

  await prisma.$transaction(async (tx) => {
    const order = existing
      ? await tx.order.update({ where: { id: existing.id }, data: baseData })
      : await tx.order.create({
          data: {
            ...baseData,
            createdAt: inkhubCreatedAt ?? new Date(),
          },
        });

    await tx.orderLineItem.deleteMany({ where: { orderId: order.id } });
    if (lineData.length > 0) {
      await tx.orderLineItem.createMany({
        data: lineData.map((line) => ({ ...line, orderId: order.id })),
      });
    }
  });

  return { created: !existing, orderId: inkhubOrderId };
}

export async function syncInkhubStore(input: InkhubSyncInput) {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, inkhubShopId: true },
  });
  if (!store) throw new Error("Store not found");
  if (store.inkhubShopId !== input.shopId) {
    throw new Error("Inkhub shop mapping changed; refusing to sync stale job");
  }

  const cutoff = new Date(Date.now() - RECENT_SYNC_DAYS * 24 * 60 * 60 * 1000);
  const recent = input.mode === "recent";
  let page = 1;
  let pagesFetched = 0;
  let ordersSeen = 0;
  let ordersSynced = 0;
  let totalPages = 1;

  while (page <= totalPages) {
    const result = await fetchInkhubOrdersPage(input.tenantId, input.shopId, page);
    pagesFetched += 1;
    totalPages = Math.max(totalPages, result.totalPages);
    ordersSeen += result.items.length;

    for (const item of result.items) {
      if (recent && !withinRecentWindow(item, cutoff)) continue;
      await upsertOrder(input.tenantId, input.storeId, input.shopId, item);
      ordersSynced += 1;
    }

    if (recent && canStopRecentPage(result.items, cutoff)) break;
    if (result.items.length === 0) break;
    page += 1;
  }

  return { mode: input.mode, shopId: input.shopId, pagesFetched, ordersSeen, ordersSynced };
}

export { RECENT_SYNC_DAYS };
