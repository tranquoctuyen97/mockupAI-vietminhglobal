import { describe, expect, it } from "vitest";

import { parseAnalyticsRequest } from "./route";

describe("Triple Whale analytics request", () => {
  it("parses repeated shop IDs and comparison mode", () => {
    const params = new URLSearchParams(
      "from=2026-08-01&to=2026-08-07&comparison=previous_period&shopId=a&shopId=b",
    );
    expect(parseAnalyticsRequest(params)).toEqual({
      range: { from: "2026-08-01", to: "2026-08-07" },
      comparison: "previous_period",
      shopIds: ["a", "b"],
    });
  });

  it("rejects missing, inverted, invalid comparison, and ranges over 366 days", () => {
    expect(() => parseAnalyticsRequest(new URLSearchParams("to=2026-08-01"))).toThrow(
      "from and to required",
    );
    expect(() =>
      parseAnalyticsRequest(new URLSearchParams("from=2026-08-02&to=2026-08-01")),
    ).toThrow("Invalid date range: from must be on or before to");
    expect(() =>
      parseAnalyticsRequest(
        new URLSearchParams("from=2026-08-01&to=2026-08-01&comparison=tomorrow"),
      ),
    ).toThrow("Invalid comparison mode");
    expect(() =>
      parseAnalyticsRequest(new URLSearchParams("from=2025-01-01&to=2026-01-02")),
    ).toThrow("Date range cannot exceed 366 days");
  });
});
