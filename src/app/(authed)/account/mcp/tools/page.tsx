import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { getMcpToolReference } from "@/lib/mcp/tools/catalog-docs";
import ToolReferenceClient from "./ToolReferenceClient";

export default async function McpToolsPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  const allowed =
    session.role === "ADMIN" &&
    (await hasFeature(session.tenantId, session.role, "mcp_access"));
  if (!allowed) {
    return (
      <section className="card card-lg max-w-2xl">
        <h2 className="text-card-heading">MCP Access permission is required</h2>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Tool Reference becomes available before profile activation, as soon as
          SUPER_ADMIN grants MCP Access to the ADMIN role.
        </p>
      </section>
    );
  }
  return <ToolReferenceClient tools={getMcpToolReference()} />;
}
