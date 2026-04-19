import { prisma } from "@/lib/db";

// In-memory cache for feature flags (TTL 60s)
// Will upgrade to Redis cache in Phase 1
const cache = new Map<string, { enabled: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Server-side: Check if a feature flag is enabled
 * Cache TTL 60s, fallback to DB
 */
export async function isEnabled(key: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.enabled;
  }

  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true, rolloutPercent: true },
    });

    if (!flag) {
      cache.set(key, { enabled: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }

    // Rollout percent check (simple random for now)
    const enabled = flag.enabled && Math.random() * 100 < flag.rolloutPercent;
    cache.set(key, { enabled, expiresAt: now + CACHE_TTL_MS });
    return enabled;
  } catch (error) {
    console.error("[FEATURE_FLAGS] Failed to check flag:", key, error);
    // Fallback: return cached value or false
    return cached?.enabled ?? false;
  }
}

/**
 * Invalidate cache for a specific flag (after toggle)
 */
export function invalidateFlag(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all cached flags
 */
export function invalidateAllFlags(): void {
  cache.clear();
}
