import { describe, expect, it } from "vitest";

import { summarizeDashboardOrderRows } from "./dashboard-orders";

describe("dashboard internal order analytics", () => {
  it("keeps actual Inkhub cost separate and leaves pending cost out of the total", () => {
    const result = summarizeDashboardOrderRows(
      [
        {
          date: "2026-08-01",
          orderCount: 2,
          actualTotalCost: "10.50",
          actualCostOrderCount: 1,
          pendingCostOrderCount: 1,
        },
        {
          date: "2026-08-02",
          orderCount: 1,
          actualTotalCost: "7.25",
          actualCostOrderCount: 1,
          pendingCostOrderCount: 0,
        },
      ],
      "2026-08-01",
      "2026-08-02",
    );

    expect(result.orderCount).toBe(3);
    expect(result.actualTotalCost).toBe(17.75);
    expect(result.actualCostOrderCount).toBe(2);
    expect(result.pendingCostOrderCount).toBe(1);
    expect(result.daily).toEqual([
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
    ]);
  });

  it("returns null actual cost when every order is still pending", () => {
    const result = summarizeDashboardOrderRows(
      [
        {
          date: "2026-08-01",
          orderCount: 2,
          actualTotalCost: null,
          actualCostOrderCount: 0,
          pendingCostOrderCount: 2,
        },
      ],
      "2026-08-01",
      "2026-08-01",
    );

    expect(result.actualTotalCost).toBeNull();
    expect(result.pendingCostOrderCount).toBe(2);
  });
});
