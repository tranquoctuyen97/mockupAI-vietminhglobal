import assert from "node:assert/strict";
import test from "node:test";
import { getToken, _resetForTest, _setCredentialsForTest } from "./token";

function makeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: 1, exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function resetWithCredentials(): void {
  _resetForTest();
  _setCredentialsForTest({ username: "test-user", password: "test-password" });
}

test("calls login once and caches token", async () => {
  resetWithCredentials();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 1 }] }) } as Response;
  };
  await getToken("test-tenant");
  await getToken("test-tenant");
  assert.equal(callCount, 1);
});

test("returns correct orgId from organizations[0].id", async () => {
  resetWithCredentials();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 42 }] }),
  } as Response);
  const { orgId } = await getToken("test-tenant");
  assert.equal(orgId, "42");
});

test("refreshes after _resetForTest simulates expiry", async () => {
  resetWithCredentials();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 1 }] }) } as Response;
  };
  await getToken("test-tenant");
  resetWithCredentials();
  await getToken("test-tenant");
  assert.equal(callCount, 2);
});

test("throws when login returns non-ok status", async () => {
  resetWithCredentials();
  globalThis.fetch = async () => ({ ok: false, status: 401 } as Response);
  await assert.rejects(() => getToken("test-tenant"), /Inkhub login failed: 401/);
});
