import { describe, expect, it } from "vitest";

import { parseDashboardOrderAnalyticsRequest } from "./route";

describe("Dashboard internal order analytics request", () => {
  it("uses the dashboard date range and optional Triple Whale shop id", () => {
    expect(
      parseDashboardOrderAnalyticsRequest(
        new URLSearchParams(
          "from=2026-08-01&to=2026-08-07&shopId=credential-1&timezone=America%2FLos_Angeles",
        ),
      ),
    ).toEqual({
      from: "2026-08-01",
      to: "2026-08-07",
      shopId: "credential-1",
      timezone: "America/Los_Angeles",
    });
  });

  it("rejects missing, inverted, and oversized ranges", () => {
    expect(() => parseDashboardOrderAnalyticsRequest(new URLSearchParams("to=2026-08-01"))).toThrow(
      "from and to required",
    );
    expect(() =>
      parseDashboardOrderAnalyticsRequest(new URLSearchParams("from=2026-08-08&to=2026-08-01")),
    ).toThrow("Invalid date range");
    expect(() =>
      parseDashboardOrderAnalyticsRequest(new URLSearchParams("from=2025-01-01&to=2026-01-02")),
    ).toThrow("Date range cannot exceed 366 days");
  });
});
