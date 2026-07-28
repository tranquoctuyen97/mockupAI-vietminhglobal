import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { MCP_TOOL_GROUPS, type McpAuthContext, type McpToolGroup } from "./contracts";
import { enabledMcpToolPreferences, getEffectiveMcpToolGroups } from "./permission-service";

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OAuthClientRecord = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

type OAuthOwnerRecord = {
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

type OAuthCodeRecord = {
  id: string;
  profileId: string;
  oauthClientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string[];
  expiresAt: Date;
  consumedAt: Date | null;
};

type OAuthGrantRecord = {
  id: string;
  profileId: string;
  oauthClientId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
};

type VerifiedOAuthGrant = OAuthGrantRecord & {
  clientId: string;
  ownerUserId: string;
  tenantId: string;
  ownerRole: string;
  ownerStatus: string;
  profileStatus: string;
  toolPreferences: unknown;
  currentGroups: ReadonlySet<McpToolGroup>;
};

type OAuthDependencies = {
  createClient(input: {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    grantTypes: string[];
    responseTypes: string[];
    tokenEndpointAuthMethod: string;
  }): Promise<OAuthClientRecord>;
  findClient(clientId: string): Promise<OAuthClientRecord | null>;
  loadOwner(ownerUserId: string): Promise<OAuthOwnerRecord | null>;
  storeCode(input: {
    profileId: string;
    oauthClientId: string;
    codeHash: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: McpToolGroup[];
    expiresAt: Date;
  }): Promise<void>;
  consumeCode(codeHash: string): Promise<OAuthCodeRecord | null>;
  createGrant(input: {
    profileId: string;
    oauthClientId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    tokenPrefix: string;
    scopes: McpToolGroup[];
    expiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<OAuthGrantRecord>;
  findRefreshGrant(refreshTokenHash: string): Promise<VerifiedOAuthGrant | OAuthGrantRecord | null>;
  rotateGrant(
    grantId: string,
    input: {
      profileId: string;
      oauthClientId: string;
      accessTokenHash: string;
      refreshTokenHash: string;
      tokenPrefix: string;
      scopes: McpToolGroup[];
      expiresAt: Date;
      refreshExpiresAt: Date;
    },
  ): Promise<OAuthGrantRecord | null>;
  enableProfile(profileId: string): Promise<void>;
  findAccessGrant?(accessTokenHash: string): Promise<VerifiedOAuthGrant | null>;
};

export type OAuthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export class OAuthProtocolError extends Error {
  constructor(
    public readonly error:
      | "invalid_request"
      | "invalid_client"
      | "invalid_client_metadata"
      | "invalid_grant"
      | "invalid_scope"
      | "unsupported_grant_type",
    public readonly errorDescription: string,
    public readonly status = 400,
  ) {
    super(errorDescription);
    this.name = "OAuthProtocolError";
  }
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function randomSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function allowedOwnerScopes(owner: OAuthOwnerRecord): Set<McpToolGroup> {
  const preferences = enabledMcpToolPreferences(
    owner.profile?.toolPreferences,
    owner.currentGroups,
  );
  return new Set(
    MCP_TOOL_GROUPS.filter((group) => owner.currentGroups.has(group) && preferences.has(group)),
  );
}

function assertRequestedScopes(
  requested: readonly McpToolGroup[],
  allowed: ReadonlySet<McpToolGroup>,
): McpToolGroup[] {
  if (requested.length === 0 || requested.some((scope) => !allowed.has(scope))) {
    throw new OAuthProtocolError("invalid_scope", "Requested OAuth scope is not currently allowed");
  }
  return MCP_TOOL_GROUPS.filter((group) => requested.includes(group));
}

function tokenResponse(input: {
  accessToken: string;
  refreshToken: string;
  scopes: readonly McpToolGroup[];
}): OAuthTokenResponse {
  return {
    access_token: input.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: input.refreshToken,
    scope: input.scopes.join(" "),
  };
}

export function createMcpOAuthService(deps: OAuthDependencies) {
  async function registerPublicOAuthClient(input: {
    clientName: string;
    redirectUris: string[];
  }): Promise<{ clientId: string }> {
    const clientName = input.clientName.trim();
    if (
      !clientName ||
      clientName.length > 120 ||
      input.redirectUris.length === 0 ||
      input.redirectUris.length > 10 ||
      input.redirectUris.some((uri) => uri.length > 2048 || !isAllowedRedirectUri(uri))
    ) {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "Invalid public OAuth client metadata",
      );
    }
    const clientId = randomSecret("mcp_client_");
    await deps.createClient({
      clientId,
      clientName,
      redirectUris: [...new Set(input.redirectUris)],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    });
    return { clientId };
  }

  async function createAuthorizationCode(input: {
    ownerUserId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod?: string;
    scopes: McpToolGroup[];
    state?: string;
  }): Promise<{ code: string; redirectTo: string }> {
    const client = await deps.findClient(input.clientId);
    if (!client || !client.redirectUris.includes(input.redirectUri)) {
      throw new OAuthProtocolError("invalid_request", "OAuth client or redirect URI is invalid");
    }
    if (
      (input.codeChallengeMethod ?? "S256") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)
    ) {
      throw new OAuthProtocolError("invalid_request", "PKCE S256 challenge is required");
    }
    const owner = await deps.loadOwner(input.ownerUserId);
    if (
      !owner ||
      owner.role !== "ADMIN" ||
      owner.status !== "ACTIVE" ||
      !owner.profile ||
      !["SETUP_INCOMPLETE", "ENABLED"].includes(owner.profile.status)
    ) {
      throw new OAuthProtocolError("invalid_grant", "MCP profile is not eligible to authorize");
    }
    const scopes = assertRequestedScopes(input.scopes, allowedOwnerScopes(owner));
    const code = randomSecret("mcp_code_");
    await deps.storeCode({
      profileId: owner.profile.id,
      oauthClientId: client.id,
      codeHash: hashSecret(code),
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: "S256",
      scopes,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    });
    const redirect = new URL(input.redirectUri);
    redirect.searchParams.set("code", code);
    if (input.state) redirect.searchParams.set("state", input.state);
    return { code, redirectTo: redirect.toString() };
  }

  async function exchangeAuthorizationCode(input: {
    clientId: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenResponse> {
    const client = await deps.findClient(input.clientId);
    if (!client) {
      throw new OAuthProtocolError("invalid_client", "Unknown OAuth client");
    }
    const code = await deps.consumeCode(hashSecret(input.code));
    if (
      !code ||
      code.oauthClientId !== client.id ||
      code.redirectUri !== input.redirectUri ||
      code.consumedAt ||
      code.expiresAt.getTime() <= Date.now()
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "Authorization code is invalid, expired, or already used",
      );
    }
    const expected = createHash("sha256").update(input.codeVerifier).digest("base64url");
    const expectedBuffer = Buffer.from(expected);
    const challengeBuffer = Buffer.from(code.codeChallenge);
    if (
      expectedBuffer.length !== challengeBuffer.length ||
      !timingSafeEqual(expectedBuffer, challengeBuffer)
    ) {
      throw new OAuthProtocolError("invalid_grant", "PKCE verifier is incorrect");
    }
    const scopes = code.scopes.filter((scope): scope is McpToolGroup =>
      MCP_TOOL_GROUPS.includes(scope as McpToolGroup),
    );
    const accessToken = randomSecret("mcp_oauth_at_");
    const refreshToken = randomSecret("mcp_oauth_rt_");
    await deps.createGrant({
      profileId: code.profileId,
      oauthClientId: code.oauthClientId,
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      tokenPrefix: accessToken.slice(0, 20),
      scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    await deps.enableProfile(code.profileId);
    return tokenResponse({ accessToken, refreshToken, scopes });
  }

  async function refreshOAuthGrant(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<OAuthTokenResponse> {
    const client = await deps.findClient(input.clientId);
    const previous = await deps.findRefreshGrant(hashSecret(input.refreshToken));
    if (
      !client ||
      !previous ||
      previous.oauthClientId !== client.id ||
      previous.revokedAt ||
      previous.refreshExpiresAt.getTime() <= Date.now()
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "Refresh token is invalid, expired, revoked, or replayed",
      );
    }
    const scopes = previous.scopes.filter((scope): scope is McpToolGroup =>
      MCP_TOOL_GROUPS.includes(scope as McpToolGroup),
    );
    const accessToken = randomSecret("mcp_oauth_at_");
    const refreshToken = randomSecret("mcp_oauth_rt_");
    const rotated = await deps.rotateGrant(previous.id, {
      profileId: previous.profileId,
      oauthClientId: previous.oauthClientId,
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      tokenPrefix: accessToken.slice(0, 20),
      scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    if (!rotated) {
      throw new OAuthProtocolError("invalid_grant", "Refresh token was already rotated");
    }
    return tokenResponse({ accessToken, refreshToken, scopes });
  }

  async function verifyOAuthAccessToken(accessToken: string): Promise<McpAuthContext> {
    if (!/^mcp_oauth_at_[A-Za-z0-9_-]{43}$/.test(accessToken) || !deps.findAccessGrant) {
      throw new OAuthProtocolError("invalid_grant", "Invalid access token", 401);
    }
    const grant = await deps.findAccessGrant(hashSecret(accessToken));
    if (
      !grant ||
      grant.revokedAt ||
      grant.expiresAt.getTime() <= Date.now() ||
      grant.ownerRole !== "ADMIN" ||
      grant.ownerStatus !== "ACTIVE" ||
      grant.profileStatus !== "ENABLED"
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "Access token is expired, revoked, or ineligible",
        401,
      );
    }
    const preferences = enabledMcpToolPreferences(grant.toolPreferences, grant.currentGroups);
    const scopes = new Set(
      MCP_TOOL_GROUPS.filter(
        (group) =>
          grant.scopes.includes(group) && grant.currentGroups.has(group) && preferences.has(group),
      ),
    );
    if (scopes.size === 0) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "Access token has no current effective scope",
        401,
      );
    }
    return {
      tenantId: grant.tenantId,
      userId: grant.ownerUserId,
      profileId: grant.profileId,
      credentialId: grant.id,
      credentialKind: "OAUTH",
      scopes,
    };
  }

  return {
    registerPublicOAuthClient,
    createAuthorizationCode,
    exchangeAuthorizationCode,
    refreshOAuthGrant,
    verifyOAuthAccessToken,
  };
}

async function verifiedGrant(accessTokenHash: string): Promise<VerifiedOAuthGrant | null> {
  const grant = await prisma.mcpOAuthGrant.findUnique({
    where: { accessTokenHash },
    include: {
      client: true,
      profile: {
        include: { owner: true },
      },
    },
  });
  if (!grant) return null;
  return {
    ...grant,
    clientId: grant.client.clientId,
    ownerUserId: grant.profile.ownerUserId,
    tenantId: grant.profile.tenantId,
    ownerRole: grant.profile.owner.role,
    ownerStatus: grant.profile.owner.status,
    profileStatus: grant.profile.status,
    toolPreferences: grant.profile.toolPreferences,
    currentGroups: await getEffectiveMcpToolGroups(
      grant.profile.tenantId,
      grant.profile.owner.role,
    ),
  };
}

const oauthService = createMcpOAuthService({
  createClient: (input) =>
    prisma.mcpOAuthClient.create({
      data: input,
    }),
  findClient: (clientId) => prisma.mcpOAuthClient.findUnique({ where: { clientId } }),
  loadOwner: async (ownerUserId) => {
    const owner = await prisma.user.findUnique({
      where: { id: ownerUserId },
      include: { mcpProfile: true },
    });
    if (!owner) return null;
    return {
      id: owner.id,
      tenantId: owner.tenantId,
      role: owner.role,
      status: owner.status,
      profile: owner.mcpProfile,
      currentGroups: await getEffectiveMcpToolGroups(owner.tenantId, owner.role),
    };
  },
  storeCode: async (input) => {
    await prisma.mcpOAuthAuthorizationCode.create({ data: input });
  },
  consumeCode: async (codeHash) =>
    prisma.$transaction(async (tx) => {
      const code = await tx.mcpOAuthAuthorizationCode.findUnique({
        where: { codeHash },
      });
      if (!code || code.consumedAt || code.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      return tx.mcpOAuthAuthorizationCode.update({
        where: { id: code.id },
        data: { consumedAt: new Date() },
      });
    }),
  createGrant: (input) => prisma.mcpOAuthGrant.create({ data: input }),
  findRefreshGrant: async (refreshTokenHash) => {
    const grant = await prisma.mcpOAuthGrant.findUnique({
      where: { refreshTokenHash },
    });
    return grant;
  },
  rotateGrant: (grantId, input) =>
    prisma.$transaction(async (tx) => {
      const result = await tx.mcpOAuthGrant.updateMany({
        where: { id: grantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) return null;
      return tx.mcpOAuthGrant.create({ data: input });
    }),
  enableProfile: async (profileId) => {
    await prisma.mcpProfile.updateMany({
      where: { id: profileId, status: "SETUP_INCOMPLETE" },
      data: { status: "ENABLED", enabledAt: new Date() },
    });
  },
  findAccessGrant: verifiedGrant,
});

export const registerPublicOAuthClient = oauthService.registerPublicOAuthClient;
export const createAuthorizationCode = oauthService.createAuthorizationCode;
export const exchangeAuthorizationCode = oauthService.exchangeAuthorizationCode;
export const refreshOAuthGrant = oauthService.refreshOAuthGrant;
export const verifyOAuthAccessToken = oauthService.verifyOAuthAccessToken;

export async function getOAuthClient(clientId: string) {
  return prisma.mcpOAuthClient.findUnique({ where: { clientId } });
}
