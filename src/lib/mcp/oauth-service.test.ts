import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMcpOAuthService, OAuthProtocolError } from "./oauth-service";

function challenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function harness() {
  const clients = new Map<string, any>();
  const codes = new Map<string, any>();
  const grants = new Map<string, any>();
  const consumed = new Set<string>();

  const service = createMcpOAuthService({
    createClient: async (input) => {
      const row = { id: `db_${input.clientId}`, ...input };
      clients.set(input.clientId, row);
      return row;
    },
    findClient: async (clientId) => clients.get(clientId) ?? null,
    loadOwner: async () => ({
      id: "user_1",
      tenantId: "tenant_1",
      role: "ADMIN",
      status: "ACTIVE",
      profile: {
        id: "profile_1",
        status: "SETUP_INCOMPLETE",
        toolPreferences: null,
      },
      currentGroups: new Set(["store_discovery", "wizard"]),
    }),
    storeCode: async (input) => {
      codes.set(input.codeHash, {
        id: `code_${codes.size + 1}`,
        ...input,
        consumedAt: null,
      });
    },
    consumeCode: async (codeHash) => {
      const row = codes.get(codeHash);
      if (!row || consumed.has(codeHash)) return null;
      consumed.add(codeHash);
      return row;
    },
    createGrant: async (input) => {
      const row = {
        id: `grant_${grants.size + 1}`,
        ...input,
        revokedAt: null,
      };
      grants.set(row.refreshTokenHash, row);
      return row;
    },
    findRefreshGrant: async (refreshTokenHash) => grants.get(refreshTokenHash) ?? null,
    rotateGrant: async (grantId, input) => {
      const previous = [...grants.values()].find((grant) => grant.id === grantId);
      if (!previous || previous.revokedAt) return null;
      previous.revokedAt = new Date();
      const next = {
        ...previous,
        id: `${grantId}_rotated`,
        ...input,
        revokedAt: null,
      };
      grants.set(next.refreshTokenHash, next);
      return next;
    },
    enableProfile: async () => undefined,
  });

  return { service };
}

test("registers only approved public-client redirect URIs", async () => {
  const { service } = harness();
  const httpsClient = await service.registerPublicOAuthClient({
    clientName: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  assert.match(httpsClient.clientId, /^mcp_client_/);

  await service.registerPublicOAuthClient({
    clientName: "Codex CLI",
    redirectUris: ["http://127.0.0.1:1455/callback"],
  });
  await assert.rejects(
    () =>
      service.registerPublicOAuthClient({
        clientName: "Bad",
        redirectUris: ["http://evil.example/callback"],
      }),
    (error: unknown) =>
      error instanceof OAuthProtocolError && error.error === "invalid_client_metadata",
  );
});

test("exchanges a one-time S256 code and rejects replay or wrong verifier", async () => {
  const { service } = harness();
  const { clientId } = await service.registerPublicOAuthClient({
    clientName: "Claude",
    redirectUris: ["https://claude.ai/callback"],
  });
  const verifier = "a".repeat(64);
  const authorization = await service.createAuthorizationCode({
    ownerUserId: "user_1",
    clientId,
    redirectUri: "https://claude.ai/callback",
    codeChallenge: challenge(verifier),
    scopes: ["store_discovery", "wizard"],
    state: "state_1",
  });
  assert.match(authorization.redirectTo, /code=/);
  assert.match(authorization.redirectTo, /state=state_1/);

  await assert.rejects(
    () =>
      service.exchangeAuthorizationCode({
        clientId,
        code: authorization.code,
        redirectUri: "https://claude.ai/callback",
        codeVerifier: "b".repeat(64),
      }),
    (error: unknown) => error instanceof OAuthProtocolError && error.error === "invalid_grant",
  );

  const authorization2 = await service.createAuthorizationCode({
    ownerUserId: "user_1",
    clientId,
    redirectUri: "https://claude.ai/callback",
    codeChallenge: challenge(verifier),
    scopes: ["store_discovery"],
  });
  const tokens = await service.exchangeAuthorizationCode({
    clientId,
    code: authorization2.code,
    redirectUri: "https://claude.ai/callback",
    codeVerifier: verifier,
  });
  assert.equal(tokens.token_type, "Bearer");
  assert.match(tokens.access_token, /^mcp_oauth_at_/);
  assert.match(tokens.refresh_token, /^mcp_oauth_rt_/);

  await assert.rejects(
    () =>
      service.exchangeAuthorizationCode({
        clientId,
        code: authorization2.code,
        redirectUri: "https://claude.ai/callback",
        codeVerifier: verifier,
      }),
    (error: unknown) => error instanceof OAuthProtocolError && error.error === "invalid_grant",
  );
});

test("rejects redirect mismatch, unsupported PKCE, and unavailable scopes", async () => {
  const { service } = harness();
  const { clientId } = await service.registerPublicOAuthClient({
    clientName: "Claude",
    redirectUris: ["https://claude.ai/callback"],
  });
  const base = {
    ownerUserId: "user_1",
    clientId,
    redirectUri: "https://other.example/callback",
    codeChallenge: challenge("a".repeat(64)),
    scopes: ["store_discovery" as const],
  };
  await assert.rejects(() => service.createAuthorizationCode(base), OAuthProtocolError);
  await assert.rejects(
    () =>
      service.createAuthorizationCode({
        ...base,
        redirectUri: "https://claude.ai/callback",
        codeChallengeMethod: "plain",
      }),
    OAuthProtocolError,
  );
  await assert.rejects(
    () =>
      service.createAuthorizationCode({
        ...base,
        redirectUri: "https://claude.ai/callback",
        scopes: ["publish"],
      }),
    OAuthProtocolError,
  );
});

test("refresh rotates the grant so replay fails", async () => {
  const { service } = harness();
  const { clientId } = await service.registerPublicOAuthClient({
    clientName: "Claude",
    redirectUris: ["https://claude.ai/callback"],
  });
  const verifier = "a".repeat(64);
  const authorization = await service.createAuthorizationCode({
    ownerUserId: "user_1",
    clientId,
    redirectUri: "https://claude.ai/callback",
    codeChallenge: challenge(verifier),
    scopes: ["store_discovery"],
  });
  const tokens = await service.exchangeAuthorizationCode({
    clientId,
    code: authorization.code,
    redirectUri: "https://claude.ai/callback",
    codeVerifier: verifier,
  });
  const rotated = await service.refreshOAuthGrant({
    clientId,
    refreshToken: tokens.refresh_token,
  });
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  await assert.rejects(
    () =>
      service.refreshOAuthGrant({
        clientId,
        refreshToken: tokens.refresh_token,
      }),
    (error: unknown) => error instanceof OAuthProtocolError && error.error === "invalid_grant",
  );
});
