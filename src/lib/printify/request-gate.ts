import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DEFAULT_PRINTIFY_RATE_LIMIT_DELAY_MS = Number(
  process.env.PRINTIFY_RATE_LIMIT_DELAY_MS ?? 60_000,
);

type RedisLike = Pick<Redis, "pttl" | "set" | "disconnect">;

type PrintifyCooldownBucket = "general" | "catalog" | "product-publish";
type EndpointCategory = PrintifyCooldownBucket | "upload" | "other";

export class PrintifyCooldownActiveError extends Error {
  public readonly retryAt: Date;
  public readonly merchantAccountId: string;
  public readonly endpoint: string;
  public readonly method: string;

  constructor(input: {
    retryAt: Date;
    merchantAccountId: string;
    endpoint: string;
    method: string;
  }) {
    super("Printify Merchant account cooldown is active.");
    this.name = "PrintifyCooldownActiveError";
    this.retryAt = input.retryAt;
    this.merchantAccountId = input.merchantAccountId;
    this.endpoint = input.endpoint;
    this.method = input.method;
  }
}

export class PrintifyRequestGate {
  private merchantAccountId: string;
  private redis: RedisLike;
  private ownsRedis: boolean;

  constructor(input: { merchantAccountId: string; redis?: RedisLike }) {
    this.merchantAccountId = input.merchantAccountId;
    this.redis = input.redis ?? createRedisClient();
    this.ownsRedis = !input.redis;
  }

  async beforeRequest(input: { endpoint: string; method: string }): Promise<void> {
    try {
      const buckets = cooldownBucketsForEndpoint(input.endpoint);
      for (const bucket of buckets) {
        const ttlMs = await this.redis.pttl(printifyCooldownKey(this.merchantAccountId, bucket));
        if (ttlMs > 0) {
          throw new PrintifyCooldownActiveError({
            retryAt: new Date(Date.now() + ttlMs),
            merchantAccountId: this.merchantAccountId,
            endpoint: input.endpoint,
            method: input.method,
          });
        }
      }
    } catch (error) {
      if (error instanceof PrintifyCooldownActiveError) throw error;
      console.warn("[PrintifyRequestGate] Cooldown check failed; continuing without gate:", {
        merchantAccountId: this.merchantAccountId,
        endpoint: input.endpoint,
        method: input.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async afterRateLimit(input: {
    endpoint: string;
    method: string;
    retryAfterMs?: number | null;
  }): Promise<void> {
    const delayMs =
      input.retryAfterMs ?? retryDelayWithJitter(DEFAULT_PRINTIFY_RATE_LIMIT_DELAY_MS);
    const category = endpointCategory(input.endpoint);
    await this.redis.set(
      printifyCooldownKey(this.merchantAccountId, "general"),
      String(Date.now() + delayMs),
      "PX",
      delayMs,
    );

    if (category === "catalog" || category === "product-publish") {
      await this.redis.set(
        printifyCooldownKey(this.merchantAccountId, category),
        String(Date.now() + delayMs),
        "PX",
        delayMs,
      );
    }
  }

  close(): void {
    if (this.ownsRedis) this.redis.disconnect();
  }
}

export function printifyCooldownKey(
  merchantAccountId: string,
  bucket: PrintifyCooldownBucket,
): string {
  return `printify:cooldown:${merchantAccountId}:${bucket}`;
}

export function endpointCategory(endpoint: string): EndpointCategory {
  if (endpoint.includes("/uploads/images.json")) return "upload";
  if (endpoint.startsWith("/catalog/")) return "catalog";
  if (/\/shops\/[^/]+\/products\/[^/]+\/publish\.json$/.test(endpoint)) {
    return "product-publish";
  }
  return "other";
}

function cooldownBucketsForEndpoint(endpoint: string): PrintifyCooldownBucket[] {
  const category = endpointCategory(endpoint);
  if (category === "catalog" || category === "product-publish") {
    return ["general", category];
  }
  return ["general"];
}

function retryDelayWithJitter(baseDelayMs: number): number {
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelayMs * 0.2)));
  return baseDelayMs + jitter;
}

function createRedisClient(): Redis {
  return new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
  });
}
