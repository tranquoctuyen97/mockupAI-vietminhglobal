import { randomBytes, createHash } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const SESSION_COOKIE_NAME = "mockupai_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generate a cryptographically secure session token
 */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a session token with SHA256 for storage
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a new session for a user and set the HTTP-only cookie
 */
export async function createSession(
  userId: string,
  request: Request,
): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  const userAgent = request.headers.get("user-agent") || undefined;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined;

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent,
      ip,
    },
  });

  // Set HTTP-only cookie
  // Detect HTTPS from x-forwarded-proto (ngrok/proxy) or NODE_ENV
  const isSecure =
    process.env.NODE_ENV === "production" ||
    request.headers.get("x-forwarded-proto") === "https";

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS / 1000,
    path: "/",
  });

  return token;
}

/**
 * In-memory session cache — eliminates redundant DB round-trips when
 * multiple API Route Handlers fire in parallel on the same page load.
 * React.cache() only deduplicates within a single SSR render tree;
 * Route Handlers each run in their own request context so it has no effect.
 *
 * TTL: 5 seconds — short enough that logout/status changes propagate quickly,
 * long enough to cover the burst of 2-6 concurrent API calls per page.
 */
const SESSION_CACHE_TTL_MS = 5_000;
const SESSION_CACHE_CLEANUP_INTERVAL_MS = 30_000;

interface CachedSession {
  user: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
    status: string;
    mustChangePassword: boolean;
  };
  expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();

// Periodic cleanup to prevent memory leaks from expired entries
if (typeof globalThis !== "undefined") {
  const cleanupKey = "__sessionCacheCleanup";
  if (!(globalThis as any)[cleanupKey]) {
    (globalThis as any)[cleanupKey] = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of sessionCache) {
        if (entry.expiresAt <= now) sessionCache.delete(key);
      }
    }, SESSION_CACHE_CLEANUP_INTERVAL_MS);
  }
}

/**
 * Validate the current session from cookie
 * Returns user data or null if invalid/expired
 *
 * Wrapped with React.cache() so that multiple calls within the same SSR
 * render tree (e.g., (authed)/layout.tsx + admin/layout.tsx + page.tsx)
 * share a single DB round-trip. Has no effect inside API Route Handlers,
 * which each run in their own independent request context.
 *
 * The in-memory sessionCache above covers the Route Handler case —
 * parallel API calls within a 5s window share the same DB result.
 */
export const validateSession = cache(async function _validateSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  const tokenHash = hashToken(token);

  // Check in-memory cache first
  const cached = sessionCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          role: true,
          status: true,
          mustChangePassword: true,
        },
      },
    },
  });

  if (!session) return null;

  // Check expiration
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  // Check user is active
  if (session.user.status !== "ACTIVE") {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  // Cache the result
  sessionCache.set(tokenHash, {
    user: session.user,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });

  return session.user;
});

/**
 * Revoke a specific session
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {
    // Session may already be deleted
  });
}

/**
 * Revoke all sessions for a user (used when disabling user)
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * Clear session cookie
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Get current session token hash from cookie (for logout)
 */
export async function getCurrentTokenHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return hashToken(token);
}
