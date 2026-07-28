export const MCP_TOOL_GROUPS = [
  "store_discovery",
  "design_library",
  "mockup_library",
  "wizard",
  "publish",
] as const;

export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

export type McpAuthContext = {
  tenantId: string;
  userId: string;
  profileId: string;
  credentialId: string;
  credentialKind: "PAT" | "OAUTH";
  scopes: ReadonlySet<McpToolGroup>;
};
