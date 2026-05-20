import type { TWDailyRecord, TWMetric, TWSummaryResponse } from "./types";

const TW_API_BASE = "https://api.triplewhale.com/api/v2";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Map of metricId → value from the TW metrics response */
function buildMetricMap(metrics: TWMetric[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const m of metrics) {
    map[m.metricId] = toNumber(m.values?.current);
    // also store by id for convenience
    map[m.id] = toNumber(m.values?.current);
  }
  return map;
}

/** Convert TW metrics response into a single aggregated record */
function metricsToRecord(metrics: TWMetric[], startDate: string): TWDailyRecord {
  const m = buildMetricMap(metrics);
  const orderRevenue = m["totalSales"] ?? m["sales"] ?? 0;
  const netProfit = m["totalNetProfit"] ?? 0;
  const orders = Math.round(m["totalOrders"] ?? m["orders"] ?? 0);
  const paymentGateways = m["totalPaymentGatewayCosts"] ?? m["paymentGateways"] ?? 0;
  const shipping = m["totalShippingCosts"] ?? m["shipping"] ?? 0;
  const blendedAdSpend = m["blendedAds"] ?? m["adsSpend"] ?? 0;
  const cogs = m["totalProductCosts"] ?? m["cogs"] ?? 0;
  const totalCost = paymentGateways + shipping + blendedAdSpend + cogs;
  const netMargin = orderRevenue > 0 ? netProfit / orderRevenue : 0;

  return {
    date: startDate,
    orderRevenue,
    netProfit,
    netMargin,
    orders,
    paymentGateways,
    shipping,
    blendedAdSpend,
    cogs,
    totalCost,
  };
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
  todayHour?: number;
}): Promise<TWDailyRecord[]> {
  const res = await fetch(`${TW_API_BASE}/summary-page/get-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
    },
    body: JSON.stringify({
      shopDomain: opts.shopDomain,
      period: {
        start: opts.startDate,
        end: opts.endDate,
      },
      todayHour: opts.todayHour ?? new Date().getUTCHours(),
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

  // New response format: { metrics: [...] }
  if (!Array.isArray(json) && "metrics" in json && Array.isArray(json.metrics)) {
    return [metricsToRecord(json.metrics, opts.startDate)];
  }

  // Legacy fallback: array of daily records
  const rawRecords: unknown[] = Array.isArray(json) ? json : [];
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
