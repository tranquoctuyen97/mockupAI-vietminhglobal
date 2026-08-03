/**
 * GET /api/listings/order-stats
 *
 * Returns order counts and daily order buckets for the requested listings.
 * Counts are distinct orders, so an order with multiple line items for the
 * same listing is counted once.
 */

import { NextResponse } from "next/server";
import { getListingOrderStats } from "@/lib/analytics/listing-orders";
import { validateSession } from "@/lib/auth/session";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function parseDate(value: string | null): Date | null {
  if (!value || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);

  const from = parseDate(url.searchParams.get("from")) ?? defaultFrom;
  const to = parseDate(url.searchParams.get("to")) ?? today;
  const toExclusive = new Date(to);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const rangeDays = Math.ceil((toExclusive.getTime() - from.getTime()) / 86_400_000);
  if (from > to || rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Date range must be between 1 and ${MAX_RANGE_DAYS} days` },
      { status: 400 },
    );
  }

  const requestedIds = [...new Set(url.searchParams.getAll("listingId"))].filter(Boolean);
  if (requestedIds.length === 0) {
    return NextResponse.json({ from: formatDate(from), to: formatDate(to), stats: {} });
  }

  const stats = await getListingOrderStats(session.tenantId, requestedIds, from, toExclusive);

  return NextResponse.json({ from: formatDate(from), to: formatDate(to), stats });
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
