import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSummaryData, TWRateLimitError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Triple Whale summary client", () => {
  it("posts the selected start and end date", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ metrics: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await fetchSummaryData({
      apiKey: "secret",
      shopDomain: "a.myshopify.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      todayHour: 9,
    });

    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      shopDomain: "a.myshopify.com",
      period: { start: "2026-07-01", end: "2026-07-31" },
      todayHour: 9,
    });
  });

  it("preserves Retry-After and quota headers on a 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: {
              "Retry-After": "120",
              "RateLimit-Policy": "100;w=60",
              RateLimit: "limit=100, remaining=0, reset=120",
            },
          }),
      ),
    );

    const error = await fetchSummaryData({
      apiKey: "secret",
      shopDomain: "a.myshopify.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TWRateLimitError);
    expect(error).toMatchObject({
      retryAfterMs: 120_000,
      policy: "100;w=60",
      limit: "limit=100, remaining=0, reset=120",
      shopDomain: "a.myshopify.com",
      range: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(String(error)).not.toContain("secret");
  });
});
