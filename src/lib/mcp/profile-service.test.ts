import assert from "node:assert/strict";
import test from "node:test";
import { createMcpProfileLifecycle, McpProfileError } from "./profile-service";

type Profile = {
  id: string;
  ownerUserId: string;
  tenantId: string;
  status: string;
  suspensionReason: string | null;
};

function harness(input?: {
  role?: string;
  status?: string;
  hasAccess?: boolean;
  profileStatus?: string | null;
}) {
  const events: string[] = [];
  let profile: Profile | null =
    input?.profileStatus === null
      ? null
      : {
          id: "profile_1",
          ownerUserId: "user_1",
          tenantId: "tenant_1",
          status: input?.profileStatus ?? "SETUP_INCOMPLETE",
          suspensionReason: null,
        };

  const lifecycle = createMcpProfileLifecycle({
    loadUser: async () => ({
      id: "user_1",
      tenantId: "tenant_1",
      role: input?.role ?? "ADMIN",
      status: input?.status ?? "ACTIVE",
    }),
    hasMcpAccess: async () => input?.hasAccess ?? true,
    loadOwnProfile: async () => profile,
    createProfile: async (user) => {
      profile = {
        id: "profile_1",
        ownerUserId: user.id,
        tenantId: user.tenantId,
        status: "SETUP_INCOMPLETE",
        suspensionReason: null,
      };
      return profile;
    },
    updateProfile: async (_id, data) => {
      assert.ok(profile);
      profile = { ...profile, ...data };
      return profile;
    },
    suspendProfilesForRole: async () => 2,
    audit: async (action) => {
      events.push(action);
    },
  });

  return { lifecycle, events, getProfile: () => profile };
}

test("ADMIN creates and enables only their own MCP profile", async () => {
  const { lifecycle, events } = harness({ profileStatus: null });
  const created = await lifecycle.createOwnMcpProfile("user_1");
  assert.equal(created.status, "SETUP_INCOMPLETE");
  const enabled = await lifecycle.enableOwnMcpProfile("user_1");
  assert.equal(enabled.status, "ENABLED");
  assert.deepEqual(events, ["mcp.profile.created", "mcp.profile.enabled"]);
});

test("disabled or non-ADMIN users cannot create, enable, or resume", async () => {
  for (const input of [
    { role: "OPERATOR" },
    { role: "SUPER_ADMIN" },
    { status: "DISABLED" },
    { hasAccess: false },
  ]) {
    const { lifecycle } = harness(input);
    await assert.rejects(() => lifecycle.enableOwnMcpProfile("user_1"), McpProfileError);
  }
});

test("permission changes suspend but never auto-resume a profile", async () => {
  const { lifecycle, getProfile } = harness({ profileStatus: "ENABLED" });
  const count = await lifecycle.suspendMcpProfilesForRoleChange(
    "tenant_1",
    "ADMIN",
    "MCP_ACCESS_REMOVED",
  );
  assert.equal(count, 2);
  assert.equal(getProfile()?.status, "ENABLED");
});

test("owner must explicitly resume after eligibility is restored", async () => {
  const { lifecycle, events, getProfile } = harness({
    profileStatus: "SUSPENDED",
  });
  const resumed = await lifecycle.resumeOwnMcpProfile("user_1");
  assert.equal(resumed.status, "ENABLED");
  assert.equal(resumed.suspensionReason, null);
  assert.equal(getProfile()?.status, "ENABLED");
  assert.deepEqual(events, ["mcp.profile.resumed"]);
});

test("owner disable is explicit and does not revoke account permissions", async () => {
  const { lifecycle, events } = harness({ profileStatus: "ENABLED" });
  const disabled = await lifecycle.disableOwnMcpProfile("user_1");
  assert.equal(disabled.status, "DISABLED");
  assert.deepEqual(events, ["mcp.profile.disabled"]);
});
