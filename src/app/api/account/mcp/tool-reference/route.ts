import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { getMcpToolReference } from "@/lib/mcp/tools/catalog-docs";

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allowed =
    session.role === "ADMIN" && (await hasFeature(session.tenantId, session.role, "mcp_access"));
  if (!allowed) {
    return NextResponse.json(
      {
        error: "MCP Access permission is required to view the runnable catalog.",
        tools: [],
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ tools: getMcpToolReference() });
}
