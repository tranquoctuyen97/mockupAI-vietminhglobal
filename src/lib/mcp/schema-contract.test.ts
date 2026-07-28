import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("MCP persistence schema contains profile, credentials, OAuth, operations, and transfers", () => {
  for (const model of [
    "McpProfile",
    "McpCredential",
    "McpOAuthClient",
    "McpOAuthAuthorizationCode",
    "McpOAuthGrant",
    "McpIdempotencyRecord",
    "McpAssetTransfer",
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  assert.match(schema, /ownerUserId\s+String\s+@unique\s+@map\("owner_user_id"\)/);
  assert.match(schema, /@@unique\(\[profileId, toolName, idempotencyKey\]\)/);
  assert.match(schema, /sourceUrlRedacted\s+String\s+@map\("source_url_redacted"\)/);
});

test("MCP lifecycle enums preserve the approved states", () => {
  assert.match(
    schema,
    /enum McpProfileStatus \{\s+SETUP_INCOMPLETE\s+ENABLED\s+DISABLED\s+SUSPENDED\s+\}/,
  );
  assert.match(schema, /enum McpCredentialStatus \{\s+ACTIVE\s+REVOKED\s+\}/);
  assert.match(schema, /enum McpIdempotencyStatus \{\s+IN_PROGRESS\s+SUCCEEDED\s+\}/);
  assert.match(
    schema,
    /enum McpAssetTransferStatus \{\s+FETCHING\s+READY\s+ATTACHED\s+FAILED\s+\}/,
  );
});
