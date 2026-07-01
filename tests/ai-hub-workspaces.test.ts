import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemberWorkspacePath,
  isPathAllowed,
  normalizeWorkspacePath,
} from "../src/lib/ai-hub/workspaces";

test("buildMemberWorkspacePath appends member id under root", () => {
  assert.equal(
    buildMemberWorkspacePath("/srv/ai-hub/members/", "user_123"),
    "/srv/ai-hub/members/user_123",
  );
});

test("normalizeWorkspacePath removes trailing slashes except root", () => {
  assert.equal(normalizeWorkspacePath("/srv/ai-hub/common/"), "/srv/ai-hub/common");
  assert.equal(normalizeWorkspacePath("/"), "/");
});

test("isPathAllowed accepts exact path and child path", () => {
  const allowlist = ["/srv/ai-hub/members/user_123", "/srv/ai-hub/common"];

  assert.equal(isPathAllowed("/srv/ai-hub/members/user_123", allowlist), true);
  assert.equal(isPathAllowed("/srv/ai-hub/members/user_123/project-a", allowlist), true);
  assert.equal(isPathAllowed("/srv/ai-hub/common", allowlist), true);
});

test("isPathAllowed rejects sibling prefix escape", () => {
  const allowlist = ["/srv/ai-hub/members/user_123"];

  assert.equal(isPathAllowed("/srv/ai-hub/members/user_1234", allowlist), false);
  assert.equal(isPathAllowed("/srv/ai-hub/members/user_1234/project", allowlist), false);
});
