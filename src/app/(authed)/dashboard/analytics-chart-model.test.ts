import { describe, expect, it } from "vitest";

import { buildPieSlices, buildShopColorMap } from "./analytics-chart-model";

describe("dashboard shop distribution chart model", () => {
  it("keeps shop colors stable across metrics and calculates normal shares", () => {
    const distribution = {
      orderRevenue: [
        { shopId: "tm", label: "TM", value: 75 },
        { shopId: "ym", label: "YM", value: 25 },
      ],
      orders: [
        { shopId: "ym", label: "YM", value: 1 },
        { shopId: "tm", label: "TM", value: 3 },
      ],
      blendedAdSpend: [],
      totalCost: [],
      netProfit: [],
    };
    const colors = buildShopColorMap(distribution);
    const revenue = buildPieSlices(distribution.orderRevenue, colors);
    const orders = buildPieSlices(distribution.orders, colors);

    expect(revenue.map(({ shopId, percent }) => ({ shopId, percent }))).toEqual([
      { shopId: "tm", percent: 75 },
      { shopId: "ym", percent: 25 },
    ]);
    expect(orders.find((slice) => slice.shopId === "tm")?.color).toBe(
      revenue.find((slice) => slice.shopId === "tm")?.color,
    );
  });

  it("uses absolute magnitude for mixed-sign profit without losing signed values", () => {
    const items = [
      { shopId: "profit", label: "Profit", value: 40 },
      { shopId: "loss", label: "Loss", value: -10 },
      { shopId: "zero", label: "Zero", value: 0 },
    ];
    const slices = buildPieSlices(items, {
      profit: "#54a9ed",
      loss: "#6fcf97",
      zero: "#f2b84b",
    });

    expect(slices.find((slice) => slice.shopId === "profit")).toMatchObject({
      value: 40,
      magnitude: 40,
      percent: 80,
    });
    expect(slices.find((slice) => slice.shopId === "loss")).toMatchObject({
      value: -10,
      magnitude: 10,
      percent: 20,
    });
    expect(slices.find((slice) => slice.shopId === "zero")).toMatchObject({
      value: 0,
      magnitude: 0,
      percent: 0,
    });
  });

  it("keeps zero-value shops in the model and returns zero percentages for all-zero data", () => {
    expect(
      buildPieSlices([{ shopId: "zero", label: "Zero", value: 0 }], { zero: "#54a9ed" }),
    ).toEqual([
      {
        shopId: "zero",
        label: "Zero",
        value: 0,
        magnitude: 0,
        percent: 0,
        color: "#54a9ed",
      },
    ]);
  });
});
