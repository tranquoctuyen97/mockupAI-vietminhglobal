import type { ShopifyClient } from "./client";

export const SHOPIFY_REPORTS_API_VERSION = "2026-01";

const SHOPIFYQL_GRAPHQL_QUERY = `
  query ShopifyProductSales($shopifyql: String!) {
    shopifyqlQuery(query: $shopifyql) {
      tableData {
        columns {
          name
          dataType
          displayName
        }
        rows
      }
      parseErrors
    }
  }
`;

type ShopifyQlRow = Record<string, unknown>;

type ShopifyProductSalesApiResponse = {
  shopifyqlQuery?: {
    tableData?: {
      columns?: Array<{ name?: string; dataType?: string; displayName?: string }>;
      rows?: unknown[] | null;
    } | null;
    parseErrors?: unknown;
  } | null;
};

export type ShopifyProductSalesSnapshotRow = {
  productTitle: string | null;
  netItemsSold: number;
  totalSales: string;
};

export type ShopifyProductSalesSnapshot = {
  from: string;
  to: string;
  currencyCode: string;
  fetchedAt: string;
  rows: ShopifyProductSalesSnapshotRow[];
  totals: {
    netItemsSold: number;
    totalSales: string;
  };
};

export type ShopifyProductSalesParseOptions = {
  currencyCode: string;
  from: string;
  to: string;
  now?: () => Date;
};

export class ShopifyProductSalesResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyProductSalesResponseError";
  }
}

export function buildShopifyProductSalesQuery(input: { from: string; to: string }): string {
  return [
    "FROM sales",
    "SHOW net_items_sold, total_sales",
    "WHERE product_title != 'Shipping Insurance'",
    "GROUP BY product_title",
    `SINCE ${input.from}`,
    `UNTIL ${input.to}`,
    "ORDER BY total_sales DESC",
    "WITH TOTALS",
  ].join(" ");
}

export function parseShopifyProductSalesResponse(
  response: ShopifyProductSalesApiResponse,
  options: ShopifyProductSalesParseOptions,
): ShopifyProductSalesSnapshot {
  const report = response.shopifyqlQuery;
  if (!report) {
    throw new ShopifyProductSalesResponseError("ShopifyQL response is missing shopifyqlQuery");
  }

  const parseErrors = normalizeParseErrors(report.parseErrors);
  if (parseErrors.length > 0) {
    throw new ShopifyProductSalesResponseError(parseErrors.join("; "));
  }

  const tableData = report.tableData;
  if (!tableData || !Array.isArray(tableData.rows)) {
    throw new ShopifyProductSalesResponseError("ShopifyQL response is missing tableData rows");
  }

  const rows = tableData.rows.map((value, index) => parseRow(value, index));
  const firstRow = rows.length > 0 ? asRecord(tableData.rows[0]) : null;
  const totals = rows.length === 0
    ? { netItemsSold: 0, totalSales: "0" }
    : {
        netItemsSold: parseInteger(firstRow?.net_items_sold__totals, "net_items_sold__totals"),
        totalSales: parseDecimal(firstRow?.total_sales__totals, "total_sales__totals"),
      };

  return {
    from: options.from,
    to: options.to,
    currencyCode: options.currencyCode,
    fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
    rows,
    totals,
  };
}

export async function fetchShopifyProductSales(
  client: Pick<ShopifyClient, "graphql">,
  input: { from: string; to: string; currencyCode: string; now?: () => Date },
): Promise<ShopifyProductSalesSnapshot> {
  const response = await client.graphql<ShopifyProductSalesApiResponse>(SHOPIFYQL_GRAPHQL_QUERY, {
    shopifyql: buildShopifyProductSalesQuery(input),
  });

  return parseShopifyProductSalesResponse(response, input);
}

function parseRow(value: unknown, index: number): ShopifyProductSalesSnapshotRow {
  const row = asRecord(value);
  const productTitle = row.product_title == null ? null : String(row.product_title);
  return {
    productTitle,
    netItemsSold: parseInteger(row.net_items_sold, `rows[${index}].net_items_sold`),
    totalSales: parseDecimal(row.total_sales, `rows[${index}].total_sales`),
  };
}

function asRecord(value: unknown): ShopifyQlRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ShopifyProductSalesResponseError("ShopifyQL row is not an object");
  }
  return value as ShopifyQlRow;
}

function parseInteger(value: unknown, field: string): number {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) {
    throw new ShopifyProductSalesResponseError(`${field} must be an integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new ShopifyProductSalesResponseError(`${field} is outside the safe integer range`);
  }
  return parsed;
}

function parseDecimal(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!/^-?(?:\d+)(?:\.\d+)?$/.test(text)) {
    throw new ShopifyProductSalesResponseError(`${field} must be a decimal string`);
  }
  return text;
}

function normalizeParseErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((error) => {
      if (typeof error === "string") return error;
      if (error && typeof error === "object" && "message" in error) {
        return String((error as { message: unknown }).message);
      }
      return String(error);
    })
    .filter((error) => error.length > 0);
}
