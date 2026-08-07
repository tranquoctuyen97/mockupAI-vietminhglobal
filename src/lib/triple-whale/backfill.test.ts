import { describe, expect, it } from "vitest";

import {
  chunkDateRange,
  enqueueMissingTripleWhaleRanges,
  retryAtForTripleWhaleError,
  tripleWhaleBackfillJobId,
} from "./backfill";
import { TWRateLimitError } from "./client";
import { TWCooldownActiveError } from "./request-gate";

describe("Triple Whale historical backfill", () => {
  it("splits long inclusive ranges into bounded chunks", () => {
    expect(chunkDateRange({ from: "2026-01-01", to: "2026-03-15" }, 31)).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-03-03" },
      { from: "2026-03-04", to: "2026-03-15" },
    ]);
  });

  it("uses a deterministic tenant/shop/range job ID", () => {
    expect(tripleWhaleBackfillJobId("tenant", "shop", "2026-01-01", "2026-01-31")).toBe(
      "tw-backfill-tenant-shop-2026-01-01-2026-01-31",
    );
  });

  it("reuses an existing active range job instead of enqueueing a duplicate", async () => {
    const added: unknown[] = [];
    const queue = {
      async getJob(jobId: string) {
        return {
          id: jobId,
          data: { tenantId: "tenant" },
          progress: { status: "syncing" },
          async getState() {
            return "active";
          },
        };
      },
      async add(...args: unknown[]) {
        added.push(args);
        throw new Error("must not enqueue");
      },
    };

    const jobs = await enqueueMissingTripleWhaleRanges(
      {
        tenantId: "tenant",
        ranges: [{ shopId: "shop", from: "2026-01-01", to: "2026-01-31", scope: "current" }],
      },
      queue,
    );

    expect(added).toHaveLength(0);
    expect(jobs).toEqual([
      {
        id: "tw-backfill-tenant-shop-2026-01-01-2026-01-31",
        shopId: "shop",
        from: "2026-01-01",
        to: "2026-01-31",
        status: "syncing",
      },
    ]);
  });

  it("enqueues missing chunks with explicit range payloads", async () => {
    const added: unknown[][] = [];
    const queue = {
      async getJob() {
        return undefined;
      },
      async add(...args: unknown[]) {
        added.push(args);
        return {
          id: (args[2] as { jobId: string }).jobId,
          data: args[1],
          progress: 0,
          async getState() {
            return "waiting";
          },
        };
      },
    };

    const jobs = await enqueueMissingTripleWhaleRanges(
      {
        tenantId: "tenant",
        ranges: [{ shopId: "shop", from: "2026-01-01", to: "2026-02-01", scope: "comparison" }],
      },
      queue,
    );

    expect(added).toHaveLength(2);
    expect(added[0]?.[0]).toBe("backfill-range");
    expect(added[0]?.[1]).toEqual({
      kind: "backfill",
      tenantId: "tenant",
      credentialId: "shop",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(jobs.map((job) => job.status)).toEqual(["queued", "queued"]);
  });

  it("does not re-enqueue a completed range on a later analytics request", async () => {
    const added: unknown[][] = [];
    let removed = 0;
    const queue = {
      async getJob(jobId: string) {
        return {
          id: jobId,
          data: {
            tenantId: "tenant",
            credentialId: "shop",
            from: "2026-01-01",
            to: "2026-01-31",
          },
          progress: 100,
          async getState() {
            return "completed";
          },
          async remove() {
            removed += 1;
          },
        };
      },
      async add(...args: unknown[]) {
        added.push(args);
        throw new Error("must not enqueue");
      },
    };

    const jobs = await enqueueMissingTripleWhaleRanges(
      {
        tenantId: "tenant",
        ranges: [{ shopId: "shop", from: "2026-01-01", to: "2026-01-31", scope: "current" }],
      },
      queue,
    );

    expect(added).toHaveLength(0);
    expect(removed).toBe(0);
    expect(jobs).toEqual([
      {
        id: "tw-backfill-tenant-shop-2026-01-01-2026-01-31",
        shopId: "shop",
        from: "2026-01-01",
        to: "2026-01-31",
        status: "complete",
      },
    ]);
  });

  it("only retries a failed range when explicitly requested", async () => {
    const added: unknown[][] = [];
    let removed = 0;
    const queue = {
      async getJob(jobId: string) {
        return {
          id: jobId,
          data: {
            tenantId: "tenant",
            credentialId: "shop",
            from: "2026-01-01",
            to: "2026-01-31",
          },
          progress: 0,
          async getState() {
            return "failed";
          },
          async remove() {
            removed += 1;
          },
        };
      },
      async add(...args: unknown[]) {
        added.push(args);
        return {
          id: (args[2] as { jobId: string }).jobId,
          data: args[1],
          progress: 0,
          async getState() {
            return "waiting";
          },
        };
      },
    };
    const input = {
      tenantId: "tenant",
      ranges: [{ shopId: "shop", from: "2026-01-01", to: "2026-01-31", scope: "current" as const }],
    };

    await expect(enqueueMissingTripleWhaleRanges(input, queue)).resolves.toMatchObject([
      { status: "failed" },
    ]);
    expect(added).toHaveLength(0);
    expect(removed).toBe(0);

    await expect(
      enqueueMissingTripleWhaleRanges({ ...input, retryFailed: true }, queue),
    ).resolves.toMatchObject([{ status: "queued" }]);
    expect(added).toHaveLength(1);
    expect(removed).toBe(1);
  });

  it("uses upstream retry timing for delayed jobs", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const rateLimit = new TWRateLimitError({
      retryAfterMs: 120_000,
      policy: null,
      limit: null,
      shopDomain: "a.myshopify.com",
      range: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(retryAtForTripleWhaleError(rateLimit, now)).toBe(now.getTime() + 120_000);
    expect(
      retryAtForTripleWhaleError(
        new TWCooldownActiveError(new Date("2026-08-01T00:03:00.000Z")),
        now,
      ),
    ).toBe(now.getTime() + 180_000);
  });
});
