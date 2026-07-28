import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMcpCredentialService, McpCredentialError } from "./credential-service";

function harness() {
  const records: Array<{
    id: string;
    profileId: string;
    label: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: string[];
    status: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }> = [];
  const audits: Array<Record<string, unknown>> = [];

  const service = createMcpCredentialService({
    loadOwner: async () => ({
      id: "user_1",
      tenantId: "tenant_1",
      role: "ADMIN",
      status: "ACTIVE",
      profile: {
        id: "profile_1",
        status: "ENABLED",
        toolPreferences: null,
      },
      currentGroups: new Set(["store_discovery", "design_library", "wizard"]),
    }),
    createCredential: async (data) => {
      const record = {
        id: `credential_${records.length + 1}`,
        ...data,
        status: "ACTIVE",
        revokedAt: null,
      };
      records.push(record);
      return record;
    },
    findByTokenHash: async (tokenHash) => {
      const credential = records.find((record) => record.tokenHash === tokenHash);
      if (!credential) return null;
      return {
        ...credential,
        ownerUserId: "user_1",
        tenantId: "tenant_1",
        ownerRole: "ADMIN",
        ownerStatus: "ACTIVE",
        profileStatus: "ENABLED",
        toolPreferences: null,
        currentGroups: new Set(["store_discovery", "design_library", "wizard"]),
      };
    },
    touchCredential: async () => undefined,
    revokeCredential: async (userId, credentialId) => {
      const credential = records.find((record) => record.id === credentialId);
      if (!credential || userId !== "user_1") return false;
      credential.status = "REVOKED";
      credential.revokedAt = new Date();
      return true;
    },
    audit: async (_action, metadata) => {
      audits.push(metadata);
    },
  });

  return { service, records, audits };
}

test("creates a high-entropy PAT, stores only its hash, and narrows scopes", async () => {
  const { service, records, audits } = harness();
  const result = await service.createPersonalAccessToken({
    userId: "user_1",
    label: "Claude Desktop",
    scopes: ["store_discovery", "wizard"],
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  assert.match(result.plaintextToken, /^mcp_pat_[A-Za-z0-9_-]{43}$/);
  assert.equal(records.length, 1);
  assert.equal(
    records[0].tokenHash,
    createHash("sha256").update(result.plaintextToken).digest("hex"),
  );
  assert.equal(JSON.stringify(records).includes(result.plaintextToken), false);
  assert.deepEqual(result.credential.scopes, ["store_discovery", "wizard"]);
  assert.equal(JSON.stringify(audits).includes(result.plaintextToken), false);
  assert.equal(JSON.stringify(audits).includes("Authorization"), false);
});

test("defaults PAT scope to all currently effective groups", async () => {
  const { service } = harness();
  const result = await service.createPersonalAccessToken({
    userId: "user_1",
    label: "Codex",
    scopes: [],
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  assert.deepEqual(result.credential.scopes, ["store_discovery", "design_library", "wizard"]);
});

test("cannot mint a scope absent from current app permissions", async () => {
  const { service } = harness();
  await assert.rejects(
    () =>
      service.createPersonalAccessToken({
        userId: "user_1",
        label: "Invalid",
        scopes: ["publish"],
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    (error: unknown) => error instanceof McpCredentialError && error.code === "SCOPE_NOT_ALLOWED",
  );
});

test("verification checks current eligibility and revoke on every request", async () => {
  const { service } = harness();
  const created = await service.createPersonalAccessToken({
    userId: "user_1",
    label: "CLI",
    scopes: ["store_discovery"],
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  const auth = await service.verifyPersonalAccessToken(created.plaintextToken);
  assert.equal(auth.userId, "user_1");
  assert.deepEqual([...auth.scopes], ["store_discovery"]);

  await service.revokeOwnCredential("user_1", created.credential.id);
  await assert.rejects(
    () => service.verifyPersonalAccessToken(created.plaintextToken),
    (error: unknown) => error instanceof McpCredentialError && error.code === "CREDENTIAL_INACTIVE",
  );
});
