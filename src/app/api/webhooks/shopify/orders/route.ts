/**
 * POST /api/webhooks/shopify/orders
 * Receives orders/create + orders/updated webhooks
 * Per-store HMAC verification → dedupe → insert Order + LineItems
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAndLogWebhook } from "@/lib/webhooks/shopify";

export async function POST(request: Request) {
  // Must read raw body for HMAC verification
  const rawBody = Buffer.from(await request.arrayBuffer());
  const headers = request.headers;

  const result = await verifyAndLogWebhook(rawBody, headers);

  if (!result.valid) {
    return NextResponse.json({ error: "Invalid webhook" }, { status: 401 });
  }

  const { storeId, tenantId } = result;
  if (!storeId || !tenantId) {
    return NextResponse.json({ error: "Store context missing" }, { status: 400 });
  }

  try {
    const payload = JSON.parse(rawBody.toString("utf-8"));
    const shopifyOrderId = String(payload.id);

    // Dedupe — check unique constraint
    const existing = await prisma.order.findUnique({
      where: { shopifyOrderId },
    });

    if (existing) {
      // Update fulfillment status if orders/updated
      if (result.topic === "orders/updated") {
        const fulfillmentStatus = mapFulfillmentStatus(payload.fulfillment_status);
        await prisma.order.update({
          where: { shopifyOrderId },
          data: { fulfillmentStatus },
        });
      }
      return NextResponse.json({ ok: true, action: "updated" });
    }

    // Map line items → find matching Listings
    const lineItems = (payload.line_items || []).map((item: Record<string, unknown>) => {
      return {
        title: String(item.title || ""),
        quantity: Number(item.quantity || 1),
        priceUsd: parseFloat(String(item.price || "0")),
        // Try to match listing variant by Shopify product/variant ID
        listingVariantId: null as string | null,
      };
    });

    // Try to find listingId by matching Shopify product IDs
    const productIds = (payload.line_items || [])
      .map((item: Record<string, unknown>) => String(item.product_id))
      .filter(Boolean);

    let listingId: string | null = null;
    if (productIds.length > 0) {
      // Look for listing with matching shopifyProductId
      const listing = await prisma.listing.findFirst({
        where: {
          shopifyProductId: { in: productIds.map((id: string) => `gid://shopify/Product/${id}`) },
          tenantId,
        },
      });
      listingId = listing?.id || null;
    }

    // Insert order + line items
    await prisma.order.create({
      data: {
        tenantId,
        storeId,
        listingId,
        shopifyOrderId,
        shopifyOrderNumber: String(payload.order_number || payload.name || ""),
        customerEmail: payload.email || null,
        totalUsd: parseFloat(String(payload.total_price || "0")),
        currency: String(payload.currency || "USD"),
        fulfillmentStatus: mapFulfillmentStatus(payload.fulfillment_status),
        lineItems: {
          create: lineItems.map((item: { title: string; quantity: number; priceUsd: number; listingVariantId: string | null }) => ({
            title: item.title,
            quantity: item.quantity,
            priceUsd: item.priceUsd,
            listingVariantId: item.listingVariantId,
          })),
        },
      },
    });

    return NextResponse.json({ ok: true, action: "created" });
  } catch (error) {
    console.error("[Webhook Orders] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 },
    );
  }
}

function mapFulfillmentStatus(status: string | null | undefined): "UNFULFILLED" | "FULFILLED" | "PARTIAL" {
  switch (status) {
    case "fulfilled":
      return "FULFILLED";
    case "partial":
      return "PARTIAL";
    default:
      return "UNFULFILLED";
  }
}
