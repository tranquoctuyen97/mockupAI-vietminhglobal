import { describe, expect, it } from "vitest";

import { comparisonRange, inclusiveDayCount, presetRange } from "./date-ranges";

describe("Triple Whale date ranges", () => {
  it("uses the immediately preceding equal-length period", () => {
    expect(comparisonRange({ from: "2026-08-01", to: "2026-08-07" }, "previous_period")).toEqual({
      from: "2026-07-25",
      to: "2026-07-31",
    });
    expect(inclusiveDayCount({ from: "2026-08-01", to: "2026-08-07" })).toBe(7);
  });

  it("shifts a range by a week", () => {
    expect(comparisonRange({ from: "2026-08-01", to: "2026-08-07" }, "previous_week")).toEqual({
      from: "2026-07-25",
      to: "2026-07-31",
    });
  });

  it("clamps month, quarter, and year shifts to valid calendar dates", () => {
    expect(comparisonRange({ from: "2026-03-31", to: "2026-03-31" }, "previous_month")).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
    expect(comparisonRange({ from: "2026-05-31", to: "2026-05-31" }, "previous_quarter")).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
    expect(comparisonRange({ from: "2024-02-29", to: "2024-02-29" }, "previous_year")).toEqual({
      from: "2023-02-28",
      to: "2023-02-28",
    });
  });

  it("returns no comparison range for None", () => {
    expect(comparisonRange({ from: "2026-08-01", to: "2026-08-01" }, "none")).toBeNull();
  });

  it("builds Today in the tenant timezone", () => {
    const now = new Date("2026-08-01T05:30:00.000Z");
    expect(presetRange("today", "America/Los_Angeles", now)).toEqual({
      from: "2026-07-31",
      to: "2026-07-31",
    });
  });

  it("builds inclusive rolling and month presets", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    expect(presetRange("14d", "UTC", now)).toEqual({ from: "2026-08-02", to: "2026-08-15" });
    expect(presetRange("90d", "UTC", now)).toEqual({ from: "2026-05-18", to: "2026-08-15" });
    expect(presetRange("this_month", "UTC", now)).toEqual({
      from: "2026-08-01",
      to: "2026-08-15",
    });
  });

  it("rejects an inverted range", () => {
    expect(() => inclusiveDayCount({ from: "2026-08-02", to: "2026-08-01" })).toThrow(
      "Invalid date range: from must be on or before to",
    );
  });
});
