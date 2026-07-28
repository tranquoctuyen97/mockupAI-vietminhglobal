import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { MCP_TOOL_GROUPS, type McpAuthContext, type McpToolGroup } from "./contracts";
import { enabledMcpToolPreferences, getEffectiveMcpToolGroups } from "./permission-service";

export type CreatePatInput = {
  userId: string;
  label: string;
  scopes: McpToolGroup[];
  expiresAt: Date;
};

export type CreatedPat = {
  credential: {
    id: string;
    label: string;
    tokenPrefix: string;
    scopes: McpToolGroup[];
    expiresAt: Date;
  };
  plaintextToken: string;
};

type OwnerState = {
  id: string;
  tenantId: string;
  role: string;
  status: string;
  profile: {
    id: string;
    status: string;
    toolPreferences: unknown;
  } | null;
  currentGroups: ReadonlySet<McpToolGroup>;
};

type CredentialRecord = {
  id: string;
  profileId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type VerifiedCredentialRecord = CredentialRecord & {
  ownerUserId: string;
  tenantId: string;
  ownerRole: string;
  ownerStatus: string;
  profileStatus: string;
  toolPreferences: unknown;
  currentGroups: ReadonlySet<McpToolGroup>;
};

type CredentialDependencies = {
  loadOwner(userId: string): Promise<OwnerState | null>;
  createCredential(input: {
    profileId: string;
    label: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: McpToolGroup[];
    expiresAt: Date;
  }): Promise<CredentialRecord>;
  findByTokenHash(tokenHash: string): Promise<VerifiedCredentialRecord | null>;
  touchCredential(credentialId: string): Promise<void>;
  revokeCredential(userId: string, credentialId: string): Promise<boolean>;
  audit(action: string, metadata: Record<string, unknown>, owner?: OwnerState): Promise<void>;
};

export class McpCredentialError extends Error {
  constructor(
    public readonly code:
      | "ACCOUNT_INELIGIBLE"
      | "PROFILE_INACTIVE"
      | "SCOPE_NOT_ALLOWED"
      | "INVALID_EXPIRY"
      | "INVALID_TOKEN"
      | "CREDENTIAL_INACTIVE"
      | "CREDENTIAL_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "McpCredentialError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function allowedGroupsForOwner(owner: OwnerState): Set<McpToolGroup> {
  const preferences = enabledMcpToolPreferences(
    owner.profile?.toolPreferences,
    owner.currentGroups,
  );
  return new Set(
    MCP_TOOL_GROUPS.filter((group) => owner.currentGroups.has(group) && preferences.has(group)),
  );
}

export function createMcpCredentialService(deps: CredentialDependencies) {
  async function createPersonalAccessToken(input: CreatePatInput): Promise<CreatedPat> {
    const owner = await deps.loadOwner(input.userId);
    if (!owner || owner.role !== "ADMIN" || owner.status !== "ACTIVE") {
      throw new McpCredentialError(
        "ACCOUNT_INELIGIBLE",
        "Only an active ADMIN can create an MCP token",
      );
    }
    if (!owner.profile || owner.profile.status !== "ENABLED") {
      throw new McpCredentialError(
        "PROFILE_INACTIVE",
        "Enable the MCP profile before creating a token",
      );
    }
    if (input.expiresAt.getTime() <= Date.now()) {
      throw new McpCredentialError("INVALID_EXPIRY", "Token expiry must be in the future");
    }

    const allowed = allowedGroupsForOwner(owner);
    const requested = input.scopes.length > 0 ? new Set(input.scopes) : new Set(allowed);
    if ([...requested].some((scope) => !allowed.has(scope))) {
      throw new McpCredentialError("SCOPE_NOT_ALLOWED", "Requested scope is not currently allowed");
    }
    const scopes = MCP_TOOL_GROUPS.filter((group) => requested.has(group));
    const plaintextToken = `mcp_pat_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(plaintextToken);
    const tokenPrefix = plaintextToken.slice(0, 16);
    const credential = await deps.createCredential({
      profileId: owner.profile.id,
      label: input.label,
      tokenHash,
      tokenPrefix,
      scopes,
      expiresAt: input.expiresAt,
    });

    await deps.audit(
      "mcp.credential.created",
      {
        credentialId: credential.id,
        tokenPrefix,
        scopes,
        expiresAt: input.expiresAt.toISOString(),
      },
      owner,
    );

    return {
      credential: {
        id: credential.id,
        label: credential.label,
        tokenPrefix: credential.tokenPrefix,
        scopes,
        expiresAt: credential.expiresAt,
      },
      plaintextToken,
    };
  }

  async function verifyPersonalAccessToken(token: string): Promise<McpAuthContext> {
    if (!/^mcp_pat_[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new McpCredentialError("INVALID_TOKEN", "Invalid MCP token");
    }
    const credential = await deps.findByTokenHash(hashToken(token));
    if (!credential) {
      throw new McpCredentialError("INVALID_TOKEN", "Invalid MCP token");
    }
    if (credential.ownerRole !== "ADMIN" || credential.ownerStatus !== "ACTIVE") {
      throw new McpCredentialError("ACCOUNT_INELIGIBLE", "MCP account is no longer eligible");
    }
    if (credential.profileStatus !== "ENABLED") {
      throw new McpCredentialError("PROFILE_INACTIVE", "MCP profile is not enabled");
    }
    if (
      credential.status !== "ACTIVE" ||
      credential.revokedAt ||
      credential.expiresAt.getTime() <= Date.now()
    ) {
      throw new McpCredentialError("CREDENTIAL_INACTIVE", "MCP credential is expired or revoked");
    }

    const preferences = enabledMcpToolPreferences(
      credential.toolPreferences,
      credential.currentGroups,
    );
    const scopes = new Set(
      MCP_TOOL_GROUPS.filter(
        (group) =>
          credential.scopes.includes(group) &&
          credential.currentGroups.has(group) &&
          preferences.has(group),
      ),
    );
    if (scopes.size === 0) {
      throw new McpCredentialError(
        "CREDENTIAL_INACTIVE",
        "MCP credential has no currently effective scope",
      );
    }

    await deps.touchCredential(credential.id);
    return {
      tenantId: credential.tenantId,
      userId: credential.ownerUserId,
      profileId: credential.profileId,
      credentialId: credential.id,
      credentialKind: "PAT",
      scopes,
    };
  }

  async function revokeOwnCredential(userId: string, credentialId: string): Promise<void> {
    const owner = await deps.loadOwner(userId);
    const revoked = await deps.revokeCredential(userId, credentialId);
    if (!revoked) {
      throw new McpCredentialError("CREDENTIAL_NOT_FOUND", "MCP credential not found");
    }
    await deps.audit("mcp.credential.revoked", { credentialId }, owner ?? undefined);
  }

  return {
    createPersonalAccessToken,
    verifyPersonalAccessToken,
    revokeOwnCredential,
  };
}

async function loadOwner(userId: string): Promise<OwnerState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { mcpProfile: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    status: user.status,
    profile: user.mcpProfile,
    currentGroups: await getEffectiveMcpToolGroups(user.tenantId, user.role),
  };
}

const credentialService = createMcpCredentialService({
  loadOwner,
  createCredential: (input) =>
    prisma.mcpCredential.create({
      data: input,
    }),
  findByTokenHash: async (tokenHash) => {
    const credential = await prisma.mcpCredential.findUnique({
      where: { tokenHash },
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
      ...credential,
      ownerUserId: credential.profile.ownerUserId,
      tenantId: credential.profile.tenantId,
      ownerRole: credential.profile.owner.role,
      ownerStatus: credential.profile.owner.status,
      profileStatus: credential.profile.status,
      toolPreferences: credential.profile.toolPreferences,
      currentGroups: await getEffectiveMcpToolGroups(
        credential.profile.tenantId,
        credential.profile.owner.role,
      ),
    };
  },
  touchCredential: async (credentialId) => {
    await prisma.mcpCredential.update({
      where: { id: credentialId },
      data: { lastUsedAt: new Date() },
    });
  },
  revokeCredential: async (userId, credentialId) => {
    const result = await prisma.mcpCredential.updateMany({
      where: {
        id: credentialId,
        profile: { ownerUserId: userId },
        status: "ACTIVE",
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    });
    return result.count === 1;
  },
  audit: async (action, metadata, owner) => {
    await logAudit({
      tenantId: owner?.tenantId ?? "unknown",
      actorUserId: owner?.id,
      action,
      resourceType: "mcp_credential",
      resourceId: typeof metadata.credentialId === "string" ? metadata.credentialId : undefined,
      metadata: metadata as Prisma.InputJsonValue,
    });
  },
});

export const createPersonalAccessToken = credentialService.createPersonalAccessToken;
export const verifyPersonalAccessToken = credentialService.verifyPersonalAccessToken;
export const revokeOwnCredential = credentialService.revokeOwnCredential;
