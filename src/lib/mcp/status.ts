export type McpUserStatus =
  | "NOT_ALLOWED"
  | "AVAILABLE"
  | "SELF_ENABLED"
  | "SETUP_INCOMPLETE"
  | "CONNECTION_ISSUE"
  | "ACCESS_REVOKED";

type CredentialState = {
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type OAuthGrantState = {
  expiresAt: Date;
  revokedAt: Date | null;
};

type McpStatusInput = {
  role: string;
  userStatus: string;
  hasMcpAccess: boolean;
  profile: {
    status: string;
    credentials: CredentialState[];
    oauthGrants: OAuthGrantState[];
  } | null;
  now?: Date;
};

export function deriveMcpUserStatus({
  role,
  userStatus,
  hasMcpAccess,
  profile,
  now = new Date(),
}: McpStatusInput): McpUserStatus {
  const eligible = role === "ADMIN" && userStatus === "ACTIVE" && hasMcpAccess;

  if (!eligible) {
    return profile ? "ACCESS_REVOKED" : "NOT_ALLOWED";
  }
  if (!profile) return "AVAILABLE";
  if (profile.status === "SETUP_INCOMPLETE") return "SETUP_INCOMPLETE";
  if (profile.status !== "ENABLED") return "CONNECTION_ISSUE";

  const nowMs = now.getTime();
  const hasUsablePat = profile.credentials.some(
    (credential) =>
      credential.status === "ACTIVE" &&
      !credential.revokedAt &&
      credential.expiresAt.getTime() > nowMs,
  );
  const hasUsableOAuthGrant = profile.oauthGrants.some(
    (grant) => !grant.revokedAt && grant.expiresAt.getTime() > nowMs,
  );

  return hasUsablePat || hasUsableOAuthGrant ? "SELF_ENABLED" : "CONNECTION_ISSUE";
}
