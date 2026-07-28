import { redirect } from "next/navigation";
import { getPermissionSet } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { getEffectiveMcpToolGroups } from "@/lib/mcp/permission-service";

export default async function AccountPermissionsPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  const [features, toolGroups] = await Promise.all([
    getPermissionSet(session.tenantId, session.role),
    getEffectiveMcpToolGroups(session.tenantId, session.role),
  ]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card card-lg">
        <h2 className="text-card-heading">Inherited role permissions</h2>
        <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
          These are controlled by SUPER_ADMIN for the whole {session.role} role.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...features].sort().map((feature) => (
            <span className="badge badge-info" key={feature}>
              {feature}
            </span>
          ))}
        </div>
      </section>
      <section className="card card-lg">
        <h2 className="text-card-heading">Effective MCP tool groups</h2>
        <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
          Your credential can narrow these scopes, but cannot expand them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...toolGroups].map((group) => (
            <span className="badge badge-success" key={group}>
              {group}
            </span>
          ))}
          {toolGroups.size === 0 && (
            <span className="text-body" style={{ color: "var(--text-muted)" }}>
              No MCP tool groups are currently available.
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
