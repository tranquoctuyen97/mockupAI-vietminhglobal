import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getEffectiveMcpToolGroups } from "@/lib/mcp/permission-service";
import { DEFAULT_MCP_LIMITS } from "@/lib/mcp/rate-limit";
import McpSettingsClient from "./McpSettingsClient";

export default async function AccountMcpPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  if (session.role !== "ADMIN") {
    return (
      <section className="card card-lg max-w-2xl">
        <span className="badge badge-info">READ ONLY</span>
        <h2 className="text-card-heading mt-4">Model Context Protocol</h2>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Only ADMIN accounts can manage an MCP connection. SUPER_ADMIN controls role permissions;
          it does not create profiles or tokens for another account.
        </p>
      </section>
    );
  }

  const hasMcpAccess = await hasFeature(session.tenantId, session.role, "mcp_access");
  if (!hasMcpAccess) {
    return (
      <section className="card card-lg max-w-2xl">
        <span className="badge badge-danger">NOT ALLOWED</span>
        <h2 className="text-card-heading mt-4">MCP Access permission is required</h2>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Ask SUPER_ADMIN to grant MCP Access to the ADMIN role. No profile or token controls are
          available until that role permission exists.
        </p>
      </section>
    );
  }

  const [effectiveGroups, stores, profile] = await Promise.all([
    getEffectiveMcpToolGroups(session.tenantId, session.role),
    prisma.store.findMany({
      where: { tenantId: session.tenantId, deletedAt: null },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.mcpProfile.findUnique({
      where: { ownerUserId: session.id },
      select: {
        id: true,
        status: true,
        suspensionReason: true,
        defaultStoreId: true,
        createdAt: true,
        updatedAt: true,
        credentials: {
          select: {
            id: true,
            label: true,
            tokenPrefix: true,
            scopes: true,
            status: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
        oauthGrants: {
          select: {
            id: true,
            tokenPrefix: true,
            scopes: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
            client: { select: { clientId: true, clientName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
  ]);

  const publicUrl =
    process.env.APP_PUBLIC_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  return (
    <McpSettingsClient
      effectiveGroups={[...effectiveGroups]}
      initialProfile={profile ? JSON.parse(JSON.stringify(profile)) : null}
      publicUrl={publicUrl.replace(/\/$/, "")}
      rateLimits={DEFAULT_MCP_LIMITS}
      stores={stores}
    />
  );
}
