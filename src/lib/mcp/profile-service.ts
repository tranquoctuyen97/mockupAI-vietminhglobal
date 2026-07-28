import type { McpProfile, Prisma, UserRole } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { hasFeature } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";

type UserRecord = {
  id: string;
  tenantId: string;
  role: string;
  status: string;
};

type ProfileRecord = {
  id: string;
  ownerUserId: string;
  tenantId: string;
  status: string;
  suspensionReason: string | null;
};

type ProfileUpdate = {
  status: "SETUP_INCOMPLETE" | "ENABLED" | "DISABLED" | "SUSPENDED";
  suspensionReason?: string | null;
  enabledAt?: Date | null;
  resumedAt?: Date | null;
};

type McpProfileLifecycleDependencies = {
  loadUser(userId: string): Promise<UserRecord | null>;
  hasMcpAccess(tenantId: string, role: string): Promise<boolean>;
  loadOwnProfile(userId: string): Promise<ProfileRecord | null>;
  createProfile(user: UserRecord): Promise<ProfileRecord>;
  updateProfile(profileId: string, data: ProfileUpdate): Promise<ProfileRecord>;
  suspendProfilesForRole(tenantId: string, role: UserRole, reason: string): Promise<number>;
  audit(action: string, profile: ProfileRecord, metadata?: Record<string, unknown>): Promise<void>;
};

export class McpProfileError extends Error {
  constructor(
    public readonly code:
      | "USER_NOT_FOUND"
      | "ACCOUNT_INELIGIBLE"
      | "PROFILE_NOT_FOUND"
      | "INVALID_TRANSITION",
    message: string,
  ) {
    super(message);
    this.name = "McpProfileError";
  }
}

export function createMcpProfileLifecycle(deps: McpProfileLifecycleDependencies) {
  async function requireEligibleUser(userId: string): Promise<UserRecord> {
    const user = await deps.loadUser(userId);
    if (!user) {
      throw new McpProfileError("USER_NOT_FOUND", "User not found");
    }
    if (
      user.role !== "ADMIN" ||
      user.status !== "ACTIVE" ||
      !(await deps.hasMcpAccess(user.tenantId, user.role))
    ) {
      throw new McpProfileError(
        "ACCOUNT_INELIGIBLE",
        "Only an active ADMIN with MCP Access can manage an MCP profile",
      );
    }
    return user;
  }

  async function createOwnMcpProfile(userId: string): Promise<ProfileRecord> {
    const user = await requireEligibleUser(userId);
    const existing = await deps.loadOwnProfile(userId);
    if (existing) return existing;
    const profile = await deps.createProfile(user);
    await deps.audit("mcp.profile.created", profile);
    return profile;
  }

  async function enableOwnMcpProfile(userId: string): Promise<ProfileRecord> {
    await requireEligibleUser(userId);
    const profile = await deps.loadOwnProfile(userId);
    if (!profile) {
      throw new McpProfileError("PROFILE_NOT_FOUND", "MCP profile not found");
    }
    if (!["SETUP_INCOMPLETE", "DISABLED"].includes(profile.status)) {
      throw new McpProfileError(
        "INVALID_TRANSITION",
        "Profile cannot be enabled from its current state",
      );
    }
    const updated = await deps.updateProfile(profile.id, {
      status: "ENABLED",
      suspensionReason: null,
      enabledAt: new Date(),
    });
    await deps.audit("mcp.profile.enabled", updated);
    return updated;
  }

  async function disableOwnMcpProfile(userId: string): Promise<ProfileRecord> {
    const profile = await deps.loadOwnProfile(userId);
    if (!profile) {
      throw new McpProfileError("PROFILE_NOT_FOUND", "MCP profile not found");
    }
    const updated = await deps.updateProfile(profile.id, {
      status: "DISABLED",
      suspensionReason: null,
    });
    await deps.audit("mcp.profile.disabled", updated);
    return updated;
  }

  async function resumeOwnMcpProfile(userId: string): Promise<ProfileRecord> {
    await requireEligibleUser(userId);
    const profile = await deps.loadOwnProfile(userId);
    if (!profile) {
      throw new McpProfileError("PROFILE_NOT_FOUND", "MCP profile not found");
    }
    if (profile.status !== "SUSPENDED") {
      throw new McpProfileError(
        "INVALID_TRANSITION",
        "Only a suspended MCP profile can be resumed",
      );
    }
    const updated = await deps.updateProfile(profile.id, {
      status: "ENABLED",
      suspensionReason: null,
      resumedAt: new Date(),
    });
    await deps.audit("mcp.profile.resumed", updated);
    return updated;
  }

  async function suspendMcpProfilesForRoleChange(
    tenantId: string,
    role: UserRole,
    reason: string,
  ): Promise<number> {
    return deps.suspendProfilesForRole(tenantId, role, reason);
  }

  return {
    createOwnMcpProfile,
    enableOwnMcpProfile,
    disableOwnMcpProfile,
    resumeOwnMcpProfile,
    suspendMcpProfilesForRoleChange,
  };
}

async function auditProfile(
  action: string,
  profile: ProfileRecord,
  metadata?: Record<string, unknown>,
) {
  await logAudit({
    tenantId: profile.tenantId,
    actorUserId: profile.ownerUserId,
    action,
    resourceType: "mcp_profile",
    resourceId: profile.id,
    metadata: metadata as Prisma.InputJsonValue | undefined,
  });
}

const lifecycle = createMcpProfileLifecycle({
  loadUser: (userId) =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, role: true, status: true },
    }),
  hasMcpAccess: (tenantId, role) => hasFeature(tenantId, role, "mcp_access"),
  loadOwnProfile: (userId) => prisma.mcpProfile.findUnique({ where: { ownerUserId: userId } }),
  createProfile: (user) =>
    prisma.mcpProfile.create({
      data: {
        tenantId: user.tenantId,
        ownerUserId: user.id,
      },
    }),
  updateProfile: (profileId, data) =>
    prisma.mcpProfile.update({
      where: { id: profileId },
      data,
    }),
  suspendProfilesForRole: async (tenantId, role, reason) => {
    const result = await prisma.mcpProfile.updateMany({
      where: {
        tenantId,
        owner: { role },
        status: { in: ["SETUP_INCOMPLETE", "ENABLED"] },
      },
      data: {
        status: "SUSPENDED",
        suspensionReason: reason,
      },
    });
    if (result.count > 0) {
      await logAudit({
        tenantId,
        action: "mcp.profile.suspended",
        resourceType: "mcp_profile",
        metadata: { role, reason, count: result.count },
      });
    }
    return result.count;
  },
  audit: auditProfile,
});

export async function createOwnMcpProfile(userId: string): Promise<McpProfile> {
  return lifecycle.createOwnMcpProfile(userId) as Promise<McpProfile>;
}

export async function enableOwnMcpProfile(userId: string): Promise<McpProfile> {
  return lifecycle.enableOwnMcpProfile(userId) as Promise<McpProfile>;
}

export async function disableOwnMcpProfile(userId: string): Promise<McpProfile> {
  return lifecycle.disableOwnMcpProfile(userId) as Promise<McpProfile>;
}

export async function resumeOwnMcpProfile(userId: string): Promise<McpProfile> {
  return lifecycle.resumeOwnMcpProfile(userId) as Promise<McpProfile>;
}

export async function suspendMcpProfilesForRoleChange(
  tenantId: string,
  role: UserRole,
  reason: string,
): Promise<number> {
  return lifecycle.suspendMcpProfilesForRoleChange(tenantId, role, reason);
}

export async function suspendMcpProfileForUser(userId: string, reason: string): Promise<void> {
  const profile = await prisma.mcpProfile.findUnique({
    where: { ownerUserId: userId },
  });
  if (!profile || profile.status === "SUSPENDED") return;
  const updated = await prisma.mcpProfile.update({
    where: { id: profile.id },
    data: {
      status: "SUSPENDED",
      suspensionReason: reason,
    },
  });
  await auditProfile("mcp.profile.suspended", updated, { reason });
}
