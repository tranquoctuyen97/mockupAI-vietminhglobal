import { getPermissionSet } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { MCP_TOOL_GROUPS, type McpAuthContext, type McpToolGroup } from "./contracts";

type McpAccessState = {
  tenantId?: string;
  userId?: string;
  profileId?: string;
  userRole: string;
  userStatus: string;
  profileStatus: string;
  toolPreferences: unknown;
  credentialStatus: string;
  credentialExpiresAt: Date;
  credentialRevokedAt: Date | null;
};

type McpPermissionDependencies = {
  getRolePermissions(tenantId: string, role: string): Promise<Set<string>>;
  loadAccessState(auth: McpAuthContext): Promise<McpAccessState | null>;
};

export class McpAccessError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "ACCOUNT_INELIGIBLE"
      | "PROFILE_INACTIVE"
      | "CREDENTIAL_INACTIVE"
      | "INSUFFICIENT_SCOPE",
    message: string,
  ) {
    super(message);
    this.name = "McpAccessError";
  }
}

export function resolveMcpToolGroups(
  role: string,
  permissions: ReadonlySet<string>,
): Set<McpToolGroup> {
  if (role !== "ADMIN" || !permissions.has("mcp_access")) {
    return new Set();
  }

  const groups = new Set<McpToolGroup>(["store_discovery"]);
  if (permissions.has("designs")) groups.add("design_library");
  if (permissions.has("mockup_library")) groups.add("mockup_library");
  if (permissions.has("wizard")) groups.add("wizard");
  if (permissions.has("wizard") && permissions.has("listings")) {
    groups.add("publish");
  }

  return new Set(MCP_TOOL_GROUPS.filter((group) => groups.has(group)));
}

export function enabledMcpToolPreferences(
  value: unknown,
  currentGroups: ReadonlySet<McpToolGroup>,
): Set<McpToolGroup> {
  if (value === null || value === undefined) {
    return new Set(currentGroups);
  }
  if (Array.isArray(value)) {
    return new Set(
      value.filter(
        (item): item is McpToolGroup =>
          typeof item === "string" && MCP_TOOL_GROUPS.includes(item as McpToolGroup),
      ),
    );
  }
  if (typeof value === "object") {
    const preferences = value as Record<string, unknown>;
    return new Set(MCP_TOOL_GROUPS.filter((group) => preferences[group] === true));
  }
  return new Set();
}

export function createMcpPermissionService(deps: McpPermissionDependencies) {
  async function getEffectiveMcpToolGroups(
    tenantId: string,
    role: string,
  ): Promise<Set<McpToolGroup>> {
    const permissions = await deps.getRolePermissions(tenantId, role);
    return resolveMcpToolGroups(role, permissions);
  }

  async function assertMcpToolAccess(
    auth: McpAuthContext,
    requiredGroup: McpToolGroup,
  ): Promise<void> {
    const state = await deps.loadAccessState(auth);
    if (!state) {
      throw new McpAccessError("UNAUTHENTICATED", "Credential not found");
    }
    if (
      (state.tenantId && state.tenantId !== auth.tenantId) ||
      (state.userId && state.userId !== auth.userId) ||
      (state.profileId && state.profileId !== auth.profileId)
    ) {
      throw new McpAccessError("UNAUTHENTICATED", "Credential identity mismatch");
    }
    if (state.userRole !== "ADMIN" || state.userStatus !== "ACTIVE") {
      throw new McpAccessError("ACCOUNT_INELIGIBLE", "ADMIN account is not eligible for MCP");
    }
    if (state.profileStatus !== "ENABLED") {
      throw new McpAccessError("PROFILE_INACTIVE", "MCP profile is not enabled");
    }
    if (
      state.credentialStatus !== "ACTIVE" ||
      state.credentialRevokedAt ||
      state.credentialExpiresAt.getTime() <= Date.now()
    ) {
      throw new McpAccessError("CREDENTIAL_INACTIVE", "MCP credential is expired or revoked");
    }

    const currentGroups = await getEffectiveMcpToolGroups(auth.tenantId, state.userRole);
    const preferences = enabledMcpToolPreferences(state.toolPreferences, currentGroups);
    const effective = new Set(
      [...currentGroups].filter((group) => preferences.has(group) && auth.scopes.has(group)),
    );

    if (!effective.has(requiredGroup)) {
      throw new McpAccessError(
        "INSUFFICIENT_SCOPE",
        `MCP tool group '${requiredGroup}' is not currently allowed`,
      );
    }
  }

  return {
    getEffectiveMcpToolGroups,
    assertMcpToolAccess,
  };
}

async function loadAccessState(auth: McpAuthContext): Promise<McpAccessState | null> {
  if (auth.credentialKind === "PAT") {
    const credential = await prisma.mcpCredential.findUnique({
      where: { id: auth.credentialId },
      include: {
        profile: {
          include: {
            owner: true,
          },
        },
      },
    });
    if (!credential) return null;
    return {
      tenantId: credential.profile.tenantId,
      userId: credential.profile.ownerUserId,
      profileId: credential.profileId,
      userRole: credential.profile.owner.role,
      userStatus: credential.profile.owner.status,
      profileStatus: credential.profile.status,
      toolPreferences: credential.profile.toolPreferences,
      credentialStatus: credential.status,
      credentialExpiresAt: credential.expiresAt,
      credentialRevokedAt: credential.revokedAt,
    };
  }

  const grant = await prisma.mcpOAuthGrant.findUnique({
    where: { id: auth.credentialId },
    include: {
      profile: {
        include: {
          owner: true,
        },
      },
    },
  });
  if (!grant) return null;
  return {
    tenantId: grant.profile.tenantId,
    userId: grant.profile.ownerUserId,
    profileId: grant.profileId,
    userRole: grant.profile.owner.role,
    userStatus: grant.profile.owner.status,
    profileStatus: grant.profile.status,
    toolPreferences: grant.profile.toolPreferences,
    credentialStatus: grant.revokedAt ? "REVOKED" : "ACTIVE",
    credentialExpiresAt: grant.expiresAt,
    credentialRevokedAt: grant.revokedAt,
  };
}

const permissionService = createMcpPermissionService({
  getRolePermissions: getPermissionSet,
  loadAccessState,
});

export const getEffectiveMcpToolGroups = permissionService.getEffectiveMcpToolGroups;
export const assertMcpToolAccess = permissionService.assertMcpToolAccess;
