import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  normalizeGrantedScopes,
  SHOPIFY_REQUIRED_SCOPES,
} from "./oauth";

describe("Shopify OAuth report access", () => {
  it("requests read_reports with the existing publish scopes", () => {
    expect(SHOPIFY_REQUIRED_SCOPES).toEqual([
      "write_products",
      "read_products",
      "read_orders",
      "read_reports",
      "write_inventory",
      "read_publications",
      "write_publications",
    ]);

    const url = new URL(
      buildAuthorizationUrl(
        "state",
        "https://app.example/api/shopify/callback",
        "client-id",
        "threads.myshopify.com",
      ),
    );
    expect(url.searchParams.get("scope")?.split(",")).toEqual(SHOPIFY_REQUIRED_SCOPES);
  });

  it("normalizes comma and whitespace separated granted scopes", () => {
    expect(
      normalizeGrantedScopes("read_orders, read_reports write_products,read_reports"),
    ).toEqual(["read_orders", "read_reports", "write_products"]);
  });
});
