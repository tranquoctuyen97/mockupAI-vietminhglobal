import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("src/app/(authed)/account/mcp/page.tsx", "utf8");
const clientSource = readFileSync("src/app/(authed)/account/mcp/McpSettingsClient.tsx", "utf8");
const defaultsSource = readFileSync("src/app/api/account/mcp/defaults/route.ts", "utf8");
const testConnectionSource = readFileSync(
  "src/app/api/account/mcp/test-connection/route.ts",
  "utf8",
);
const oauthRevokeSource = readFileSync(
  "src/app/api/account/mcp/oauth-grants/[grantId]/route.ts",
  "utf8",
);

test("MCP account page is self-only and explains ineligible roles", () => {
  assert.match(pageSource, /session\.role !== "ADMIN"/);
  assert.match(pageSource, /Only ADMIN accounts can manage an MCP connection/);
  assert.match(pageSource, /MCP Access permission is required/);
  assert.doesNotMatch(pageSource + clientSource, /targetUserId|selectedAdmin|userId=/);
  assert.doesNotMatch(clientSource, /SUPER_ADMIN.*Generate|Generate.*SUPER_ADMIN/);
});

test("self-service setup includes resumable steps and defaults every group on", () => {
  for (const copy of [
    "Inherited access",
    "Choose connection",
    "Create profile & credential",
    "Connect your client",
    "Test & finish",
    "All tenant stores are listable",
    "Resume MCP",
    "Setup incomplete",
    "Create replacement",
    "Revoke OAuth grant",
  ]) {
    assert.match(clientSource, new RegExp(copy.replace("&", "\\&")));
  }
  assert.match(clientSource, /new Set\(effectiveGroups\)/);
  assert.match(clientSource, /OAuth PKCE/);
  assert.match(clientSource, /Personal access token/);
  assert.match(clientSource, /Claude|Codex|n8n/);
});

test("defaults remain convenience-only and connection test is read-only", () => {
  assert.match(defaultsSource, /defaultStoreId/);
  assert.match(defaultsSource, /tenantId: session\.tenantId/);
  assert.doesNotMatch(defaultsSource, /allowedStore|storeScope/);
  assert.match(testConnectionSource, /verifyPersonalAccessToken/);
  assert.doesNotMatch(
    testConnectionSource,
    /wizardDraft\.(create|update)|submitWizardPublish|publishQueue/,
  );
});

test("OAuth revoke is owner and tenant bound without exposing grant secrets", () => {
  assert.match(oauthRevokeSource, /ownerUserId: session\.id/);
  assert.match(oauthRevokeSource, /tenantId: session\.tenantId/);
  assert.doesNotMatch(
    oauthRevokeSource,
    /accessTokenHash|refreshTokenHash|access_token|refresh_token/,
  );
});
