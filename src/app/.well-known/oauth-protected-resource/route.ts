import { NextResponse } from "next/server";

export async function GET() {
  const origin = new URL(
    process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
  ).origin;
  return NextResponse.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [
      "store_discovery",
      "design_library",
      "mockup_library",
      "wizard",
      "publish",
    ],
  });
}
