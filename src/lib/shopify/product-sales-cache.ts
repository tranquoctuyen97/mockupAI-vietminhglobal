import { randomUUID } from "node:crypto";
import Redis from "ioredis";

import type { ShopifyProductSalesSnapshot } from "./product-sales";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_TTL_SECONDS = 600;
const LOCK_TTL_MS = 30_000;

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  disconnect(): void;
};

export type ShopifyProductSalesCacheKeyInput = {
  tenantId: string;
  storeId: string;
  from: string;
  to: string;
};

export type ShopifyProductSalesCacheLoadInput = ShopifyProductSalesCacheKeyInput & {
  currencyCode?: string;
  fetchSnapshot: () => Promise<ShopifyProductSalesSnapshot>;
};

export type ShopifyProductSalesCacheResult =
  | { status: "hit" | "loaded"; snapshot: ShopifyProductSalesSnapshot }
  | { status: "loading" };

export function productSalesCacheKey(input: ShopifyProductSalesCacheKeyInput): string {
  return `shopify-product-sales:v1:${input.tenantId}:${input.storeId}:${input.from}:${input.to}`;
}

export class ShopifyProductSalesCache {
  private readonly redis: RedisLike;
  private readonly ownsRedis: boolean;

  constructor(input: { redis?: RedisLike } = {}) {
    this.redis = input.redis ?? (createRedisClient() as unknown as RedisLike);
    this.ownsRedis = !input.redis;
  }

  async load(input: ShopifyProductSalesCacheLoadInput): Promise<ShopifyProductSalesCacheResult> {
    const key = productSalesCacheKey(input);

    let cachedValue: string | null;
    try {
      cachedValue = await this.redis.get(key);
    } catch {
      return this.loadDirect(input, "Redis cache read failed; loading Shopify directly");
    }

    if (cachedValue !== null) {
      const cachedSnapshot = parseCachedSnapshot(cachedValue, input);
      if (cachedSnapshot) {
        return { status: "hit", snapshot: cachedSnapshot };
      }
    }

    const lockKey = `${key}:lock`;
    const lockToken = randomUUID();
    let acquired: string | null;
    try {
      acquired = await this.redis.set(lockKey, lockToken, "PX", LOCK_TTL_MS, "NX");
    } catch {
      return this.loadDirect(input, "Redis cache lock failed; loading Shopify directly");
    }

    if (acquired !== "OK") {
      return { status: "loading" };
    }

    try {
      const snapshot = await input.fetchSnapshot();
      try {
        await this.redis.set(key, JSON.stringify(snapshot), "EX", CACHE_TTL_SECONDS);
      } catch {
        console.warn("[ShopifyProductSalesCache] Redis cache write failed");
      }
      return { status: "loaded", snapshot };
    } finally {
      try {
        await this.redis.eval(RELEASE_LOCK_LUA, 1, lockKey, lockToken);
      } catch {
        console.warn("[ShopifyProductSalesCache] Redis lock release failed");
      }
    }
  }

  close(): void {
    if (this.ownsRedis) {
      this.redis.disconnect();
    }
  }

  private async loadDirect(
    input: ShopifyProductSalesCacheLoadInput,
    message: string,
  ): Promise<{ status: "loaded"; snapshot: ShopifyProductSalesSnapshot }> {
    console.warn(`[ShopifyProductSalesCache] ${message}`);
    return { status: "loaded", snapshot: await input.fetchSnapshot() };
  }
}

function parseCachedSnapshot(
  value: string,
  input: ShopifyProductSalesCacheLoadInput,
): ShopifyProductSalesSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isValidSnapshot(parsed, input)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isValidSnapshot(
  value: unknown,
  input: ShopifyProductSalesCacheLoadInput,
): value is ShopifyProductSalesSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const snapshot = value as Partial<ShopifyProductSalesSnapshot>;
  if (
    snapshot.from !== input.from ||
    snapshot.to !== input.to ||
    typeof snapshot.currencyCode !== "string" ||
    (input.currencyCode !== undefined && snapshot.currencyCode !== input.currencyCode) ||
    typeof snapshot.fetchedAt !== "string" ||
    !Array.isArray(snapshot.rows) ||
    !isValidRows(snapshot.rows) ||
    !snapshot.totals ||
    typeof snapshot.totals !== "object" ||
    Array.isArray(snapshot.totals)
  ) {
    return false;
  }

  const totals = snapshot.totals as { netItemsSold?: unknown; totalSales?: unknown };
  return isSafeInteger(totals.netItemsSold) && isDecimalString(totals.totalSales);
}

function isValidRows(rows: unknown[]): boolean {
  return rows.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as {
      productTitle?: unknown;
      netItemsSold?: unknown;
      totalSales?: unknown;
    };
    return (
      (row.productTitle === null || typeof row.productTitle === "string") &&
      isSafeInteger(row.netItemsSold) &&
      isDecimalString(row.totalSales)
    );
  });
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^-?(?:\d+)(?:\.\d+)?$/.test(value);
}

function createRedisClient(): Redis {
  return new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
  });
}
