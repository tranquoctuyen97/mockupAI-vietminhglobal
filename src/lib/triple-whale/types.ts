export interface TWDailyRecord {
  date: string;
  orderRevenue: number;
  netProfit: number;
  netMargin: number;
  orders: number;
  paymentGateways: number;
  shipping: number;
  blendedAdSpend: number;
  cogs: number;
  totalCost: number;
}

/** A single metric in the TW summary-page/get-data response */
export interface TWMetric {
  id: string;
  title: string;
  metricId: string;
  tip?: string;
  services: string[];
  type: string;
  delta: number;
  values: { current: number; previous: number };
  charts: { current: unknown[]; previous: unknown[] };
}

/** Root shape of /summary-page/get-data response */
export interface TWSummaryResponse {
  metrics: TWMetric[];
}

export interface TWSyncJobPayload {
  credentialId: string;
  tenantId: string;
}
