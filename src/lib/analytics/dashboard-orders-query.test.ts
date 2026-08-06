import { describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: queryRaw },
}));

import { getDashboardOrderAnalytics } from "./dashboard-orders";

describe("dashboard order analytics query", () => {
  it("groups and orders by the selected date column instead of repeating the timezone expression", async () => {
    await getDashboardOrderAnalytics({
      tenantId: "tenant-1",
      storeIds: null,
      from: new Date("2026-08-01T00:00:00.000Z"),
      toExclusive: new Date("2026-08-02T00:00:00.000Z"),
      fromDate: "2026-08-01",
      toDate: "2026-08-01",
      timezone: "America/Los_Angeles",
    });

    const query = queryRaw.mock.calls.at(-1)?.[0] as { sql?: string } | undefined;
    expect(query?.sql).toContain("GROUP BY 1");
    expect(query?.sql).toContain("ORDER BY 1 ASC");
    expect(query?.sql).not.toContain("GROUP BY DATE_TRUNC");
  });
});
