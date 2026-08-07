import { describe, expect, it, vi } from "vitest";

import {
  buildShopifyProductSalesQuery,
  fetchShopifyProductSales,
  parseShopifyProductSalesResponse,
  SHOPIFY_REPORTS_API_VERSION,
} from "./product-sales";

describe("Shopify product sales report", () => {
  it("builds the approved inclusive ShopifyQL report", () => {
    const query = buildShopifyProductSalesQuery({ from: "2026-08-01", to: "2026-08-07" });

    expect(SHOPIFY_REPORTS_API_VERSION).toBe("2026-01");
    expect(query).toContain("FROM sales");
    expect(query).toContain("SHOW net_items_sold, total_sales");
    expect(query).toContain("WHERE product_title != 'Shipping Insurance'");
    expect(query).toContain("GROUP BY product_title");
    expect(query).toContain("SINCE 2026-08-01");
    expect(query).toContain("UNTIL 2026-08-07");
    expect(query).toContain("ORDER BY total_sales DESC");
    expect(query).toContain("WITH TOTALS");
  });

  it("parses product rows, None, and Shopify totals without converting money to float", () => {
    const result = parseShopifyProductSalesResponse(
      {
        shopifyqlQuery: {
          parseErrors: [],
          tableData: {
            columns: [],
            rows: [
              {
                product_title: null,
                net_items_sold: "1",
                total_sales: "1488.28",
                net_items_sold__totals: "7",
                total_sales__totals: "1678.32",
              },
              {
                product_title: "Good Day To Cross Stitch T-shirt",
                net_items_sold: "6",
                total_sales: "190.04",
                net_items_sold__totals: "7",
                total_sales__totals: "1678.32",
              },
            ],
          },
        },
      },
      {
        currencyCode: "USD",
        from: "2026-08-01",
        to: "2026-08-01",
        now: () => new Date("2026-08-07T00:00:00Z"),
      },
    );

    expect(result.rows).toEqual([
      { productTitle: null, netItemsSold: 1, totalSales: "1488.28" },
      {
        productTitle: "Good Day To Cross Stitch T-shirt",
        netItemsSold: 6,
        totalSales: "190.04",
      },
    ]);
    expect(result.totals).toEqual({ netItemsSold: 7, totalSales: "1678.32" });
    expect(result.fetchedAt).toBe("2026-08-07T00:00:00.000Z");
  });

  it("returns zero totals for a legitimate empty report", () => {
    const result = parseShopifyProductSalesResponse(
      { shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } } },
      { currencyCode: "USD", from: "2026-08-01", to: "2026-08-01" },
    );

    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ netItemsSold: 0, totalSales: "0" });
  });

  it("rejects ShopifyQL parse errors and malformed numeric rows", () => {
    expect(() =>
      parseShopifyProductSalesResponse(
        { shopifyqlQuery: { parseErrors: ["Invalid metric"], tableData: null } },
        { currencyCode: "USD", from: "2026-08-01", to: "2026-08-01" },
      ),
    ).toThrow("Invalid metric");

    expect(() =>
      parseShopifyProductSalesResponse(
        {
          shopifyqlQuery: {
            parseErrors: [],
            tableData: {
              columns: [],
              rows: [{ product_title: "Bad", net_items_sold: "not-a-number", total_sales: "3" }],
            },
          },
        },
        { currencyCode: "USD", from: "2026-08-01", to: "2026-08-01" },
      ),
    ).toThrow("net_items_sold");
  });

  it("passes the report as a GraphQL variable", async () => {
    const graphql = vi.fn().mockResolvedValue({
      shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } },
    });

    await fetchShopifyProductSales(
      { graphql } as never,
      { from: "2026-08-01", to: "2026-08-01", currencyCode: "USD" },
    );

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("$shopifyql: String!"), {
      shopifyql: expect.stringContaining("GROUP BY product_title"),
    });
  });
});
