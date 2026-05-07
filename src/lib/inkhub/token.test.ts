import assert from "node:assert/strict";
import test from "node:test";
import { getToken, _resetForTest } from "./token";

function makeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: 1, exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.signature`;
}

test("calls login once and caches token", async () => {
  _resetForTest();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 1 }] }) } as Response;
  };
  await getToken();
  await getToken();
  assert.equal(callCount, 1);
});

test("returns correct orgId from organizations[0].id", async () => {
  _resetForTest();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 42 }] }),
  } as Response);
  const { orgId } = await getToken();
  assert.equal(orgId, "42");
});

test("refreshes after _resetForTest simulates expiry", async () => {
  _resetForTest();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 1 }] }) } as Response;
  };
  await getToken();
  _resetForTest();
  await getToken();
  assert.equal(callCount, 2);
});

test("throws when login returns non-ok status", async () => {
  _resetForTest();
  globalThis.fetch = async () => ({ ok: false, status: 401 } as Response);
  await assert.rejects(() => getToken(), /Inkhub login failed: 401/);
});
