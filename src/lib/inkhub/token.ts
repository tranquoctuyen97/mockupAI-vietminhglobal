import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";

const LOGIN_URL = "https://api-inkhub-v2.grabink.co/api/auth/login";
const BUFFER_MS = 5 * 60 * 1000;

interface TokenCache {
  token: string;
  orgId: string;
  expiresAt: number;
}

type InkhubCredentials = { username: string; password: string };

// Per-tenant token cache
const cache = new Map<string, TokenCache>();
const pendingLogin = new Map<string, Promise<void>>();
let credentialsForTest: InkhubCredentials | null = null;

function parseJwtExp(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf-8"),
  );
  return payload.exp * 1000;
}

async function getCredentials(tenantId: string): Promise<InkhubCredentials> {
  if (credentialsForTest) return credentialsForTest;

  const row = await prisma.inkhubCredential.findUnique({
    where: { tenantId },
  });
  if (row) {
    return {
      username: row.username,
      password: decrypt(row.passwordEncrypted),
    };
  }
  // Fall back to env
  const username = process.env.INKHUB_USERNAME;
  const password = process.env.INKHUB_PASSWORD;
  if (!username || !password) throw new Error("No InkHub credentials configured");
  return { username, password };
}

async function login(tenantId: string): Promise<void> {
  const { username, password } = await getCredentials(tenantId);
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://inkhub.grabink.co",
      "referer": "https://inkhub.grabink.co/",
    },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Inkhub login failed: ${res.status}`);
  const data = (await res.json()) as {
    token: string;
    organizations: Array<{ id: number }>;
  };
  cache.set(tenantId, {
    token: data.token,
    orgId: String(data.organizations[0].id),
    expiresAt: parseJwtExp(data.token) - BUFFER_MS,
  });
}

export async function getToken(
  tenantId: string,
): Promise<{ token: string; orgId: string }> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return { token: cached.token, orgId: cached.orgId };
  }

  if (!pendingLogin.has(tenantId)) {
    const promise = login(tenantId).finally(() => {
      pendingLogin.delete(tenantId);
    });
    pendingLogin.set(tenantId, promise);
  }
  await pendingLogin.get(tenantId)!;

  const result = cache.get(tenantId)!;
  return { token: result.token, orgId: result.orgId };
}

export function invalidateToken(tenantId: string): void {
  cache.delete(tenantId);
}

export function _resetForTest(): void {
  cache.clear();
  pendingLogin.clear();
  credentialsForTest = null;
}

export function _setCredentialsForTest(credentials: InkhubCredentials): void {
  credentialsForTest = credentials;
}
