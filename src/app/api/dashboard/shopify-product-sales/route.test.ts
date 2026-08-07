import { describe, expect, it } from "vitest";

import { parseShopifyProductSalesRequest } from "./route";

describe("Dashboard Shopify product sales request", () => {
  it("uses the dashboard date range and optional Triple Whale shop id", () => {
    expect(
      parseShopifyProductSalesRequest(
        new URLSearchParams("from=2026-08-01&to=2026-08-07&shopId=credential-1"),
      ),
    ).toEqual({ from: "2026-08-01", to: "2026-08-07", shopId: "credential-1" });
  });

  it("rejects missing, inverted, malformed, and oversized ranges", () => {
    expect(() => parseShopifyProductSalesRequest(new URLSearchParams("to=2026-08-01"))).toThrow(
      "from and to required",
    );
    expect(() =>
      parseShopifyProductSalesRequest(new URLSearchParams("from=2026-08-08&to=2026-08-01")),
    ).toThrow("Invalid date range");
    expect(() =>
      parseShopifyProductSalesRequest(new URLSearchParams("from=x&to=2026-08-01")),
    ).toThrow("Invalid date range");
    expect(() =>
      parseShopifyProductSalesRequest(
        new URLSearchParams("from=2025-01-01&to=2026-01-02"),
      ),
    ).toThrow("Date range cannot exceed 366 days");
  });
});
