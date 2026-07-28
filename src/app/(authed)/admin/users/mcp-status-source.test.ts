import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource = readFileSync("src/app/api/admin/users/route.ts", "utf8");
const pageSource = readFileSync("src/app/(authed)/admin/users/page.tsx", "utf8");
const aclSource = readFileSync("src/app/(authed)/admin/acl/AclClient.tsx", "utf8");

test("SUPER_ADMIN users API exposes status without credential secrets or settings", () => {
  assert.match(apiSource, /mcpStatus/);
  assert.match(apiSource, /deriveMcpUserStatus/);
  assert.doesNotMatch(apiSource, /tokenHash|accessTokenHash|refreshTokenHash/);
  assert.doesNotMatch(apiSource, /toolPreferences|defaultStoreId/);
});

test("users table presents read-only MCP status without cross-user MCP actions", () => {
  for (const label of [
    "Not allowed",
    "Available",
    "Self-enabled",
    "Setup incomplete",
    "Connection issue",
    "Access revoked",
  ]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.doesNotMatch(pageSource, /account\/mcp\?userId|mcp\/users\//);
});

test("role ACL explains self-service ownership and immediate revocation", () => {
  assert.match(
    aclSource,
    /MCP access granted\. This admin can now set up their own MCP connection\./,
  );
  assert.match(aclSource, /Current MCP calls stop immediately\./);
  assert.doesNotMatch(aclSource, /Generate Token|Create MCP Profile/);
});
