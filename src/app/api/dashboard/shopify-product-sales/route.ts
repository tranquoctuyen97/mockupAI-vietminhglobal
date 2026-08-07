import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/auth/guards";
import { getDashboardShopifyProductSales } from "@/lib/analytics/shopify-product-sales";
import { inclusiveDayCount } from "@/lib/triple-whale/date-ranges";

const MAX_RANGE_DAYS = 366;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ShopifyProductSalesRequest = {
  from: string;
  to: string;
  shopId: string | null;
};

export function parseShopifyProductSalesRequest(
  params: URLSearchParams,
): ShopifyProductSalesRequest {
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) throw new Error("from and to required");
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw new Error("Invalid date range");
  }

  let days: number;
  try {
    days = inclusiveDayCount({ from, to });
  } catch {
    throw new Error("Invalid date range");
  }
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  return { from, to, shopId: params.get("shopId") || null };
}

export async function GET(request: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  try {
    const parsed = parseShopifyProductSalesRequest(new URL(request.url).searchParams);
    const result = await getDashboardShopifyProductSales({
      tenantId: session.tenantId,
      ...parsed,
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Shopify product sales request" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
