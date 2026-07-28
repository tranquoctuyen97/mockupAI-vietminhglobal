import assert from "node:assert/strict";
import test from "node:test";
import type { McpAuthContext } from "./contracts";
import { createMcpAuthenticator, McpHttpError, validateMcpRequestSource } from "./http-server";

const auth: McpAuthContext = {
  tenantId: "tenant_1",
  userId: "user_1",
  profileId: "profile_1",
  credentialId: "credential_1",
  credentialKind: "PAT",
  scopes: new Set(["store_discovery"]),
};

test("missing and malformed bearer tokens return a 401 challenge", async () => {
  const authenticate = createMcpAuthenticator({
    verifyPat: async () => auth,
    verifyOAuth: async () => ({ ...auth, credentialKind: "OAUTH" }),
  });
  for (const header of [undefined, "", "Basic abc", "Bearer unknown"]) {
    await assert.rejects(
      () => authenticate(header),
      (error: unknown) =>
        error instanceof McpHttpError &&
        error.status === 401 &&
        error.headers["WWW-Authenticate"] === "Bearer",
    );
  }
});

test("PAT and OAuth bearer tokens resolve server-owned auth context", async () => {
  const authenticate = createMcpAuthenticator({
    verifyPat: async (token) => {
      assert.match(token, /^mcp_pat_/);
      return auth;
    },
    verifyOAuth: async (token) => {
      assert.match(token, /^mcp_oauth_at_/);
      return { ...auth, credentialKind: "OAUTH" };
    },
  });
  assert.equal((await authenticate(`Bearer mcp_pat_${"a".repeat(43)}`)).tenantId, "tenant_1");
  assert.equal(
    (await authenticate(`Bearer mcp_oauth_at_${"a".repeat(43)}`)).credentialKind,
    "OAUTH",
  );
});

test("Host and present Origin are validated before request parsing", () => {
  const policy = {
    allowedHosts: new Set(["mcp.example.com", "127.0.0.1:3101"]),
    allowedOrigins: new Set(["https://app.example.com"]),
  };
  validateMcpRequestSource({ host: "mcp.example.com", origin: undefined }, policy);
  validateMcpRequestSource({ host: "127.0.0.1:3101", origin: "https://app.example.com" }, policy);
  assert.throws(
    () => validateMcpRequestSource({ host: "evil.example", origin: undefined }, policy),
    McpHttpError,
  );
  assert.throws(
    () =>
      validateMcpRequestSource({ host: "mcp.example.com", origin: "https://evil.example" }, policy),
    McpHttpError,
  );
});
