import assert from "node:assert/strict";
import test from "node:test";
import type { McpAuthContext, McpToolGroup } from "./contracts";
import {
  createMcpPermissionService,
  McpAccessError,
  resolveMcpToolGroups,
} from "./permission-service";

const permissionCases = [
  [["mcp_access"], ["store_discovery"]],
  [
    ["mcp_access", "designs"],
    ["store_discovery", "design_library"],
  ],
  [
    ["mcp_access", "mockup_library"],
    ["store_discovery", "mockup_library"],
  ],
  [
    ["mcp_access", "wizard"],
    ["store_discovery", "wizard"],
  ],
  [
    ["mcp_access", "wizard", "listings"],
    ["store_discovery", "wizard", "publish"],
  ],
] as const;

test("maps current ADMIN app permissions to MCP tool groups", () => {
  for (const [permissions, expected] of permissionCases) {
    assert.deepEqual([...resolveMcpToolGroups("ADMIN", new Set(permissions))], expected);
  }
  assert.deepEqual([...resolveMcpToolGroups("SUPER_ADMIN", new Set(["mcp_access", "wizard"]))], []);
  assert.deepEqual([...resolveMcpToolGroups("OPERATOR", new Set(["mcp_access", "wizard"]))], []);
});

const auth: McpAuthContext = {
  tenantId: "tenant_1",
  userId: "user_1",
  profileId: "profile_1",
  credentialId: "credential_1",
  credentialKind: "PAT",
  scopes: new Set<McpToolGroup>(["store_discovery", "design_library", "wizard"]),
};

function accessState(
  overrides: Partial<{
    userRole: string;
    userStatus: string;
    profileStatus: string;
    toolPreferences: unknown;
    credentialStatus: string;
    credentialExpiresAt: Date;
    credentialRevokedAt: Date | null;
  }> = {},
) {
  return {
    userRole: "ADMIN",
    userStatus: "ACTIVE",
    profileStatus: "ENABLED",
    toolPreferences: null,
    credentialStatus: "ACTIVE",
    credentialExpiresAt: new Date(Date.now() + 60_000),
    credentialRevokedAt: null,
    ...overrides,
  };
}

test("assertMcpToolAccess intersects app grants, profile preferences, and token scopes", async () => {
  const service = createMcpPermissionService({
    getRolePermissions: async () => new Set(["mcp_access", "designs", "wizard", "listings"]),
    loadAccessState: async () =>
      accessState({
        toolPreferences: {
          store_discovery: true,
          design_library: true,
          wizard: false,
          publish: true,
        },
      }),
  });

  await service.assertMcpToolAccess(auth, "design_library");
  await assert.rejects(
    () => service.assertMcpToolAccess(auth, "wizard"),
    (error: unknown) => error instanceof McpAccessError && error.code === "INSUFFICIENT_SCOPE",
  );
  await assert.rejects(
    () => service.assertMcpToolAccess(auth, "publish"),
    (error: unknown) => error instanceof McpAccessError && error.code === "INSUFFICIENT_SCOPE",
  );
});

test("denies inactive users, unavailable roles, disabled profiles, and invalid credentials", async () => {
  const invalidStates = [
    accessState({ userRole: "SUPER_ADMIN" }),
    accessState({ userRole: "OPERATOR" }),
    accessState({ userStatus: "DISABLED" }),
    accessState({ profileStatus: "DISABLED" }),
    accessState({ profileStatus: "SUSPENDED" }),
    accessState({ credentialStatus: "REVOKED" }),
    accessState({ credentialRevokedAt: new Date() }),
    accessState({ credentialExpiresAt: new Date(Date.now() - 1) }),
  ];

  for (const state of invalidStates) {
    const service = createMcpPermissionService({
      getRolePermissions: async () => new Set(["mcp_access", "designs"]),
      loadAccessState: async () => state,
    });
    await assert.rejects(() => service.assertMcpToolAccess(auth, "design_library"), McpAccessError);
  }
});

test("null preferences enable all current groups but missing app permission still denies", async () => {
  const service = createMcpPermissionService({
    getRolePermissions: async () => new Set(["mcp_access", "designs"]),
    loadAccessState: async () => accessState(),
  });

  await service.assertMcpToolAccess(auth, "design_library");
  await assert.rejects(() => service.assertMcpToolAccess(auth, "wizard"), McpAccessError);
});
