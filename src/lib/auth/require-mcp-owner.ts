import { NextResponse } from "next/server";
import { hasFeature } from "./roles";
import { validateSession } from "./session";

type McpOwnerGuard =
  | {
      session: NonNullable<Awaited<ReturnType<typeof validateSession>>>;
      response: null;
    }
  | { session: null; response: NextResponse };

export async function requireMcpOwner(): Promise<McpOwnerGuard> {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (
    session.role !== "ADMIN" ||
    !(await hasFeature(session.tenantId, session.role, "mcp_access"))
  ) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Forbidden — ADMIN with MCP Access only" },
        { status: 403 },
      ),
    };
  }
  return { session, response: null };
}
