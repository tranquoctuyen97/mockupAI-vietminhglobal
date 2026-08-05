import { beforeEach, describe, expect, it, vi } from "vitest";

const { getToken, invalidateToken, fetchMock } = vi.hoisted(() => ({
  getToken: vi.fn(),
  invalidateToken: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/inkhub/token", () => ({ getToken, invalidateToken }));

import { fetchInkhubOrdersPage } from "./orders-client";

describe("Inkhub orders client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockResolvedValue({ token: "token", orgId: "1" });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, totalPages: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("passes the optional date range to the orders endpoint", async () => {
    await fetchInkhubOrdersPage("tenant", 3, 2, 50, {
      fromDate: new Date("2026-07-31T17:00:00.000Z"),
      toDate: "2026-08-02T16:59:59.999Z",
    });

    const requestUrl = new URL(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.pathname).toBe("/api/orders");
    expect(requestUrl.searchParams.get("page")).toBe("2");
    expect(requestUrl.searchParams.get("pageSize")).toBe("50");
    expect(requestUrl.searchParams.get("shopIds[]")).toBe("3");
    expect(requestUrl.searchParams.get("fromDate")).toBe("2026-07-31T17:00:00.000Z");
    expect(requestUrl.searchParams.get("toDate")).toBe("2026-08-02T16:59:59.999Z");
  });

  it("keeps the legacy unbounded request when no range is provided", async () => {
    await fetchInkhubOrdersPage("tenant", 3);

    const requestUrl = new URL(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.searchParams.has("fromDate")).toBe(false);
    expect(requestUrl.searchParams.has("toDate")).toBe(false);
  });
});
