import { randomUUID } from "node:crypto";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DEFAULT_LOCK_TTL_MS = Number(process.env.PRINTIFY_MERCHANT_LOCK_TTL_MS ?? 60_000);
const DEFAULT_RENEW_INTERVAL_MS = Number(
  process.env.PRINTIFY_MERCHANT_LOCK_RENEW_INTERVAL_MS ?? 20_000,
);

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const RENEW_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

type RedisLike = Pick<Redis, "set" | "eval" | "disconnect">;

export type MerchantLockLease = {
  merchantAccountId: string;
  token: string;
  lockLost: boolean;
  throwIfLockLost(): void;
  release(): Promise<void>;
};

export class MerchantAccountLockUnavailableError extends Error {
  public readonly retryAt: Date;

  constructor(retryAt: Date) {
    super("Printify Merchant account lock is currently held by another publish job.");
    this.name = "MerchantAccountLockUnavailableError";
    this.retryAt = retryAt;
  }
}

export class MerchantAccountLockLostError extends Error {
  constructor() {
    super("Printify Merchant account lock ownership was lost.");
    this.name = "MerchantAccountLockLostError";
  }
}

export function printifyMerchantLockKey(merchantAccountId: string): string {
  return `printify:merchant-lock:${merchantAccountId}`;
}

export async function acquireMerchantAccountLock(input: {
  merchantAccountId: string;
  ttlMs?: number;
  renewIntervalMs?: number;
  redis?: RedisLike;
}): Promise<MerchantLockLease> {
  const ttlMs = input.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  const renewIntervalMs = input.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS;
  const redis = input.redis ?? createRedisClient();
  const key = printifyMerchantLockKey(input.merchantAccountId);
  const token = randomUUID();
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");

  if (acquired !== "OK") {
    if (!input.redis) redis.disconnect();
    throw new MerchantAccountLockUnavailableError(new Date(Date.now() + renewIntervalMs));
  }

  let lockLost = false;
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        const renewed = await redis.eval(RENEW_LOCK_LUA, 1, key, token, String(ttlMs));
        if (Number(renewed) !== 1) {
          lockLost = true;
          clearInterval(heartbeat);
        }
      } catch {
        lockLost = true;
        clearInterval(heartbeat);
      }
    })();
  }, renewIntervalMs);

  return {
    merchantAccountId: input.merchantAccountId,
    token,
    get lockLost() {
      return lockLost;
    },
    throwIfLockLost() {
      if (lockLost) throw new MerchantAccountLockLostError();
    },
    async release() {
      clearInterval(heartbeat);
      if (!lockLost) {
        await redis.eval(RELEASE_LOCK_LUA, 1, key, token);
      }
      if (!input.redis) redis.disconnect();
    },
  };
}

function createRedisClient(): Redis {
  return new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
  });
}
