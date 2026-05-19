import type { TWDailyRecord, TWSummaryResponse } from "./types";

const TW_API_BASE = "https://api.triplewhale.com/api/v2";

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeRecord(raw: Record<string, unknown>): TWDailyRecord {
  const get = (camel: string, snake: string) => toNumber(raw[camel] ?? raw[snake]);
  const totalCost =
    get("totalCost", "total_cost") ||
    get("cost", "cost") ||
    get("blendedAdSpend", "blended_ad_spend") +
      get("cogs", "cogs") +
      get("paymentGateways", "payment_gateways") +
      get("shipping", "shipping");

  return {
    date: String(raw.date ?? raw.reportDate ?? raw.report_date ?? ""),
    orderRevenue: get("orderRevenue", "order_revenue"),
    netProfit: get("netProfit", "net_profit"),
    netMargin: get("netMargin", "net_margin"),
    orders: Math.round(get("orders", "orders")),
    paymentGateways: get("paymentGateways", "payment_gateways"),
    shipping: get("shipping", "shipping"),
    blendedAdSpend: get("blendedAdSpend", "blended_ad_spend"),
    cogs: get("cogs", "cogs"),
    totalCost,
  };
}

export async function fetchSummaryData(opts: {
  apiKey: string;
  shopDomain: string;
  startDate: string;
  endDate: string;
}): Promise<TWDailyRecord[]> {
  const res = await fetch(`${TW_API_BASE}/summary-page/get-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
    },
    body: JSON.stringify({
      shopDomain: opts.shopDomain,
      startDate: opts.startDate,
      endDate: opts.endDate,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new TWAuthError("Invalid API key");
  }
  if (res.status === 429) {
    throw new TWRateLimitError("Rate limited by Triple Whale");
  }
  if (!res.ok) {
    throw new Error(`Triple Whale API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as TWSummaryResponse | TWDailyRecord[];
  const rawRecords: unknown[] = Array.isArray(json) ? json : (json.data ?? []);
  return rawRecords.map((record) => normalizeRecord(record as Record<string, unknown>));
}

export class TWAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TWAuthError";
  }
}

export class TWRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TWRateLimitError";
  }
}
