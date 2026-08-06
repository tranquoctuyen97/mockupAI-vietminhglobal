import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardOrderAnalyticsPanel } from "./DashboardOrderAnalytics";

describe("dashboard internal order analytics panel", () => {
  it("shows the selected date range, order count, and actual Inkhub cost", () => {
    const markup = renderToStaticMarkup(
      <DashboardOrderAnalyticsPanel
        data={{
          orderCount: 3,
          actualTotalCost: 17.75,
          actualCostOrderCount: 2,
          pendingCostOrderCount: 1,
          daily: [
            {
              date: "2026-08-01",
              count: 2,
              actualTotalCost: 10.5,
              actualCostOrderCount: 1,
              pendingCostOrderCount: 1,
            },
            {
              date: "2026-08-02",
              count: 1,
              actualTotalCost: 7.25,
              actualCostOrderCount: 1,
              pendingCostOrderCount: 0,
            },
          ],
        }}
        from="2026-08-01"
        shopMapped
        to="2026-08-02"
      />,
    );

    expect(markup).toContain('aria-label="Orders by listing"');
    expect(markup).toContain("Aug 1, 2026 – Aug 2, 2026");
    expect(markup).toContain("3 orders");
    expect(markup).toContain("Actual total cost");
    expect(markup).toContain("$17.75");
    expect(markup).toContain("1 cost pending");
  });

  it("explains when the selected Triple Whale shop has no linked internal store", () => {
    const markup = renderToStaticMarkup(
      <DashboardOrderAnalyticsPanel
        data={{
          orderCount: 0,
          actualTotalCost: null,
          actualCostOrderCount: 0,
          pendingCostOrderCount: 0,
          daily: [],
        }}
        from="2026-08-01"
        shopMapped={false}
        to="2026-08-01"
      />,
    );

    expect(markup).toContain("Shop chưa được liên kết với Store nội bộ");
  });
});
