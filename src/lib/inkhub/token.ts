const LOGIN_URL = "https://api-inkhub-v2.grabink.co/api/auth/login";
const BUFFER_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;
let cachedOrgId: string | null = null;
let expiresAt: number | null = null;
let loginPromise: Promise<void> | null = null;

function parseJwtExp(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf-8"));
  return payload.exp * 1000;
}

async function login(): Promise<void> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://inkhub.grabink.co",
      "referer": "https://inkhub.grabink.co/",
    },
    body: JSON.stringify({
      username: process.env.INKHUB_USERNAME,
      password: process.env.INKHUB_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Inkhub login failed: ${res.status}`);
  const data = (await res.json()) as { token: string; organizations: Array<{ id: number }> };
  cachedToken = data.token;
  cachedOrgId = String(data.organizations[0].id);
  expiresAt = parseJwtExp(data.token) - BUFFER_MS;
}

export async function getToken(): Promise<{ token: string; orgId: string }> {
  if (cachedToken && expiresAt && Date.now() < expiresAt) {
    return { token: cachedToken, orgId: cachedOrgId! };
  }
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  await loginPromise;
  return { token: cachedToken!, orgId: cachedOrgId! };
}

export function _resetForTest(): void {
  cachedToken = null;
  cachedOrgId = null;
  expiresAt = null;
  loginPromise = null;
}
