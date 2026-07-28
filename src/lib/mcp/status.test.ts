import assert from "node:assert/strict";
import test from "node:test";
import { deriveMcpUserStatus } from "./status";

const activeCredential = {
  status: "ACTIVE",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  revokedAt: null,
};

test("only an active ADMIN with the current role permission can use MCP", () => {
  assert.equal(
    deriveMcpUserStatus({
      role: "SUPER_ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: null,
    }),
    "NOT_ALLOWED",
  );
  assert.equal(
    deriveMcpUserStatus({
      role: "OPERATOR",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: null,
    }),
    "NOT_ALLOWED",
  );
  assert.equal(
    deriveMcpUserStatus({
      role: "ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: null,
    }),
    "AVAILABLE",
  );
});

test("a configured profile becomes access revoked when account eligibility is lost", () => {
  for (const input of [
    { role: "ADMIN", userStatus: "DISABLED", hasMcpAccess: true },
    { role: "ADMIN", userStatus: "ACTIVE", hasMcpAccess: false },
    { role: "OPERATOR", userStatus: "ACTIVE", hasMcpAccess: false },
  ]) {
    assert.equal(
      deriveMcpUserStatus({
        ...input,
        profile: {
          status: "SUSPENDED",
          credentials: [activeCredential],
          oauthGrants: [],
        },
      }),
      "ACCESS_REVOKED",
    );
  }
});

test("profile and credential state produce safe read-only status labels", () => {
  assert.equal(
    deriveMcpUserStatus({
      role: "ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: {
        status: "SETUP_INCOMPLETE",
        credentials: [],
        oauthGrants: [],
      },
    }),
    "SETUP_INCOMPLETE",
  );
  assert.equal(
    deriveMcpUserStatus({
      role: "ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: {
        status: "ENABLED",
        credentials: [activeCredential],
        oauthGrants: [],
      },
    }),
    "SELF_ENABLED",
  );
  assert.equal(
    deriveMcpUserStatus({
      role: "ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: {
        status: "ENABLED",
        credentials: [
          {
            ...activeCredential,
            expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          },
        ],
        oauthGrants: [],
      },
    }),
    "CONNECTION_ISSUE",
  );
  assert.equal(
    deriveMcpUserStatus({
      role: "ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: {
        status: "SUSPENDED",
        credentials: [activeCredential],
        oauthGrants: [],
      },
    }),
    "CONNECTION_ISSUE",
  );
});

test("an active OAuth grant is a usable self-managed connection", () => {
  assert.equal(
    deriveMcpUserStatus({
      role: "ADMIN",
      userStatus: "ACTIVE",
      hasMcpAccess: true,
      profile: {
        status: "ENABLED",
        credentials: [],
        oauthGrants: [
          {
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
            revokedAt: null,
          },
        ],
      },
    }),
    "SELF_ENABLED",
  );
});
