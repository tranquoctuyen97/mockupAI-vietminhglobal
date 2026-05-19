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

export interface TWSummaryResponse {
  data: TWDailyRecord[];
}

export interface TWSyncJobPayload {
  storeId: string;
  tenantId: string;
}
