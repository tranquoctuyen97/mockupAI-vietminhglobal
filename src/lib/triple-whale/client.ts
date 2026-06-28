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

function eachDay(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const date = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (date <= end) {
    days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

function chartValue(metric: TWMetric | undefined, index: number): number {
  const point = Array.isArray(metric?.charts?.current) ? metric.charts.current[index] : undefined;
  if (point && typeof point === "object" && "y" in point) return toNumber(point.y);
  return index === 0 ? toNumber(metric?.values?.current) : 0;
}

/** Convert TW metrics response into daily records using chart points. */
function metricsToRecords(metrics: TWMetric[], startDate: string, endDate: string): TWDailyRecord[] {
  const byMetric: Record<string, TWMetric> = Object.fromEntries(
    metrics.flatMap((metric) => [[metric.metricId, metric], [metric.id, metric]]),
  );
  return eachDay(startDate, endDate).map((date, index) => {
    const orderRevenue = chartValue(byMetric.totalSales ?? byMetric.sales, index);
    const netProfit = chartValue(byMetric.totalNetProfit, index);
    const orders = Math.round(chartValue(byMetric.totalOrders ?? byMetric.orders, index));
    const paymentGateways = chartValue(byMetric.totalPaymentGatewayCosts ?? byMetric.paymentGateways, index);
    const shipping = chartValue(byMetric.totalShippingCosts ?? byMetric.shipping, index);
    const blendedAdSpend = chartValue(byMetric.blendedAds ?? byMetric.adsSpend, index);
    const cogs = chartValue(byMetric.totalProductCosts ?? byMetric.cogs, index);
    const totalCost = paymentGateways + shipping + blendedAdSpend + cogs;

    return {
      date,
      orderRevenue,
      netProfit,
      netMargin: orderRevenue > 0 ? netProfit / orderRevenue : 0,
      orders,
      paymentGateways,
      shipping,
      blendedAdSpend,
      cogs,
      totalCost,
    };
  });
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
    return metricsToRecords(json.metrics, opts.startDate, opts.endDate);
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
