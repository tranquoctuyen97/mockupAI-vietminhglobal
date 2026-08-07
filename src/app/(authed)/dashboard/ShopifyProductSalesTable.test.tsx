import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShopifyProductSalesLoading, ShopifyProductSalesPanel } from "./ShopifyProductSalesTable";

const baseData = {
  from: "2026-08-01",
  to: "2026-08-01",
  selectedShopId: "credential-a",
  rows: [
    {
      storeId: "store-a",
      storeName: "ThreadsMuse",
      productTitle: "Good Day T-shirt",
      netItemsSold: 6,
      totalSales: "190.04",
      currencyCode: "USD",
    },
  ],
  summary: { netItemsSold: 6, totalSalesByCurrency: { USD: "190.04" } },
  stores: [{ storeId: "store-a", storeName: "ThreadsMuse", shopId: "credential-a", status: "ok" as const }],
  partial: false,
};

describe("Shopify product sales dashboard table", () => {
  it("shows a dedicated loading card before report data is ready", () => {
    const markup = renderToStaticMarkup(<ShopifyProductSalesLoading />);
    expect(markup).toContain('aria-label="Loading Shopify product sales"');
    expect(markup).toContain("Loading Shopify product sales");
  });

  it("hides Store for one shop and renders Shopify metrics", () => {
    const markup = renderToStaticMarkup(
      <ShopifyProductSalesPanel data={baseData} onRetry={() => undefined} />,
    );
    expect(markup).toContain("Product title");
    expect(markup).not.toContain(">Store</th>");
    expect(markup).toContain("Net items sold");
    expect(markup).toContain("$190.04");
  });

  it("shows Store, preserves same-title rows, and keeps empty titles as None in All shops", () => {
    const markup = renderToStaticMarkup(
      <ShopifyProductSalesPanel
        data={{
          ...baseData,
          selectedShopId: null,
          rows: [
            ...baseData.rows,
            {
              ...baseData.rows[0],
              storeId: "store-b",
              storeName: "Store B",
              productTitle: null,
              totalSales: "100.00",
            },
          ],
          summary: { netItemsSold: 12, totalSalesByCurrency: { USD: "290.04" } },
          stores: [
            ...baseData.stores,
            { storeId: "store-b", storeName: "Store B", shopId: "credential-b", status: "ok" as const },
          ],
        }}
        onRetry={() => undefined}
      />,
    );
    expect(markup).toContain(">Store</th>");
    expect(markup).toContain("ThreadsMuse");
    expect(markup).toContain("Store B");
    expect(markup).toContain(">None<");
    expect(markup).toContain("Summary");
  });

  it("discloses partial stores and renders a retry action", () => {
    const markup = renderToStaticMarkup(
      <ShopifyProductSalesPanel
        data={{
          ...baseData,
          selectedShopId: null,
          stores: [
            ...baseData.stores,
            {
              storeId: "store-b",
              storeName: "Store B",
              shopId: "credential-b",
              status: "missing_scope" as const,
              message: "Shopify read_reports scope is required",
            },
          ],
          partial: true,
        }}
        onRetry={() => undefined}
      />,
    );
    expect(markup).toContain("1/2 stores loaded");
    expect(markup).toContain("Shopify read_reports scope is required");
    expect(markup).toContain("Retry</button>");
  });

  it("renders an empty terminal report and an all-failed error state", () => {
    const emptyMarkup = renderToStaticMarkup(
      <ShopifyProductSalesPanel
        data={{ ...baseData, rows: [], summary: { netItemsSold: 0, totalSalesByCurrency: {} } }}
        onRetry={() => undefined}
      />,
    );
    expect(emptyMarkup).toContain("No Shopify product sales for this period");

    const failedMarkup = renderToStaticMarkup(
      <ShopifyProductSalesPanel
        data={{
          ...baseData,
          rows: [],
          summary: { netItemsSold: 0, totalSalesByCurrency: {} },
          stores: [{ ...baseData.stores[0], status: "token_expired" as const, message: "Shopify access token expired" }],
          partial: true,
        }}
        onRetry={() => undefined}
      />,
    );
    expect(failedMarkup).toContain("Shopify access token expired");
    expect(failedMarkup).toContain("Retry</button>");
  });
});
